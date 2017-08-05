"use strict";
var _ = require('lodash');
var request = require('request');
var cheerio = require('cheerio');
var schedule = require('node-schedule');
var moment = require('moment');
var RSVP = require('rsvp');
var nodemailer = require('nodemailer');
var fs = require("fs");
const { Ad } = require('./classes/ad.js');
const { AdStore } = require('./classes/ad-store.js');

var config = require('./config');

console.log('--------------------------------------------')
console.log('Kijiji Scrapper started');
console.log('--------------------------------------------\n')

console.log(`Watching the following page for new ads: \n${config.urls.join('\n')}\n`);

const adStore = new AdStore();

schedule.scheduleJob(`*/${config.minutesBetweenCheck} * * * *`, updateItems);
updateItems();

function updateItems() {
    const promises = config.urls.map(url => createAdFetchPromise(url));

    return RSVP.Promise.all(promises)
        .then(parsedAdsList => {
            const fetchedAds = parsedAdsList.reduce((adList1, adList2) => adList1.concat(adList2));

            if (!config.noBusinessAds) {
                processNewAds(fetchedAds);
            }

            const promises = fetchedAds.map(ad => ad.queryIsBusinessAd())
            return RSVP.Promise.all(promises)
                .then(adList => adList.filter(adItem => !adItem.isBusiness))
                .then(adList => processNewAds(adList))
        }).then(() => {
            console.log(`Ads updated, total ads in datastore: ${adStore.length}\n`);
        })
}

function createAdFetchPromise(url) {
    return new RSVP.Promise((resolve, reject) => {
        request(url, (error, response, html) => {
            const $ = cheerio.load(html);

            const parsedAds = $('div.search-item').get()
                .map(item => Ad.buildAd($(item)))

            resolve(parsedAds);
        });
    });
}

function processNewAds(fetchedAds) {
    console.log(`fetched ${fetchedAds.length} ads`)
    const newAds = adStore.add(fetchedAds);
    console.log(`${newAds.length} were new ads`)

    if (newAds.length) {
        emailAds(newAds);
    }
}

function emailAds(ads) {
    logAdsBeingEmailed(ads);

    let transporter = getMailerTransport();
    if (!transporter) {
        return;
    }

    // setup e-mail data with unicode symbols
    let mailOptions = {
        from: 'Kijiji Scraper <noreply@example.com>', // sender address
        to: `${config.email.gmailUser}@gmail.com`, // list of receivers
        subject: createAdsFoundMessage(ads), // Subject line
        text: JSON.stringify(ads), // plaintext body
        html: formatAds(ads) // html body
    };


    // send mail with defined transport object
    transporter.sendMail(mailOptions, error => {
        if (error) {
            return console.log(`Email failed: ${error}`);
        }

        console.log('Email sent successfully\n');
    });
}

function getMailerTransport() {
    if (config.email.gmailPassword) {
        return nodemailer.createTransport(
            `smtps://${config.email.gmailUser}%40gmail.com:${config.email.gmailPassword}@smtp.gmail.com`);
    }

    if (!config.email.oauth.clientId || !config.email.oauth.clientSecret || !config.email.oauth.refreshToken) {
        console.log('Could not initialize mailer as password was empty and no oauth credentials were provided')
        return null;
    }

    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            type: "OAuth2",
            user: config.email.gmailUser,
            clientId: config.email.oauth.clientId,
            clientSecret: config.email.oauth.clientSecret,
            refreshToken: config.email.oauth.refreshToken
        }
    });
}

function logAdsBeingEmailed(ads) {
    console.log('\n' + createAdsFoundMessage(ads));
    ads.forEach(ad => {
        console.log(`emailing new ad: ${ad.title}`);
    });
    console.log(``);
}

function createAdsFoundMessage(ads) {
    const numberOfAds = ads.length;
    const pluralization = numberOfAds === 1 ? 'ad' : 'ads'
    return `${numberOfAds} new ${pluralization}`;
}

function formatAds(ads) {
    const adsFoundMessage = createAdsFoundMessage(ads);
    const adsTableRows = ads.map(ad => ad.toHtml());

    return `<h1>${adsFoundMessage}</h1>` +
        `<table>${adsTableRows}</table>`;
}