const axios = require('axios')
const cheerio = require('cheerio')
const _ = require('lodash')
const moment = require('moment')
const RSVP = require('rsvp')

const config = require('../config')

class Ad {
    constructor(url, images, title, description, location, price, datePosted, requestQueue) {
        this.url = url;
        this.images = images;
        this.title = title;
        this.description = description;
        this.location = location;
        this.price = price;
        this.requestQueue = requestQueue;
        this.isBusiness = null;
        this.datePosted = datePosted;
        this.isIgnored = false;
    }

    static buildAd($jquerySelector, ignores, requestQueue) {
        var ad = new Ad();

        ad.url = 'http://www.kijiji.ca' + $jquerySelector.attr('data-vip-url');
        ad.images = [$jquerySelector.find('.image source').attr('data-srcset')];
        ad.title = $jquerySelector.find('a.title').text().trim();
        ad.description = $jquerySelector.find('.description').text().trim();
        ad.location = $jquerySelector.find('.location').text().trim();
        ad.price = $jquerySelector.find('.price').text().trim();
        ad.requestQueue = requestQueue
        ad.datePosted = Ad.determineDatePosted($jquerySelector.find('.date-posted').text().trim());

        ad.isBusiness = $jquerySelector.attr('class').includes('third-party')
        ad.isIgnored = ad.matchesTexts(ignores);

        return ad;
    }

    static determineDatePosted(datePostedText) {
        if (!datePostedText) {
            return null;
        }

        var relativeTimeRegex = /(\d+) (hour|minute|second)s? ago/;
        var match = relativeTimeRegex.exec(datePostedText);
        if (match != null) {
            return moment().subtract(match[1], match[2]);
        }

        if (datePostedText === 'Yesterday') {
            return moment().subtract(1, 'day');
        }

        var parsedDateString = moment(datePostedText, 'DD-MM-YYYY');
        if (parsedDateString.isValid()) {
            return parsedDateString;
        }

        console.error("Unexpected date posted text:" + datePostedText);
        return moment();
    }

    loadAdditionalDetails() {
        return this._getAdditionalDetails().then($ => {
            const adData = JSON.parse($('#FesLoader script').html().replace(/^window.__data=/, '').replace(/;$/, ''))

            this._loadImages(adData)
            this.latitude = _.get(adData, 'viewItemPage.viewItemData.adLocation.latitude')
            this.longitude = _.get(adData, 'viewItemPage.viewItemData.adLocation.longitude')

            return this
        }).catch(() => {
            return this
        });
    }

    _getAdditionalDetails() {
        return requestQueue.request(retry =>
            axios
                .get(this.url)
                .then(response => {
                    const $ = loadCheerio(response.data);
                    if ($) {
                        return $;
                    }

                    throw error('unable to get ad additional details');
                }));
    }

    _loadImages(adData) {
        const media = _.get(adData, 'viewItemPage.viewItemData.media');
        if (!media.length) {
            return;
        }

        const images = media.filter(media => media.type === 'image');
        if (!images.length) {
            return;
        }

        this.images = images.map(image => image.href /* could use image.thumbnail */ )
    }

    isEqual(ad) {
        return ad.url === this.url;
    }

    isInList(ads) {
        return _.some(ads, ad => this.isEqual(ad));
    }

    matchesTexts(inputTexts) {
        return _.some(
            inputTexts,
            inputText => _.some([this.title, this.description], adText => adText.toLowerCase().includes(inputText.toLowerCase())));
    }

    toHtml() {
        let html =
            `<tr><td><a href="${this.url}">${this.title}</a> Price: ${this.price}</td></tr>` +
            `<tr><td>${this.location}</td></tr>` +
            `<tr><td>${this.description}</td></tr>` +
            `<tr><td>` +
            this.images.map(image => `<a href="${this.url}"><img src="${image}"/></a>`).join('') +
            `</td></tr>`;

        if (this.latitude && this.longitude && config.map.googleMapsApiKey && config.map.homeLocation) {
            const itemLocation = `${this.latitude},${this.longitude}`
            html += `
            <tr><td>
              <a href="http://maps.google.com/?q=${itemLocation}">
                <img src="https://maps.googleapis.com/maps/api/staticmap?size=600x400&maptype=roadmap&key=${config.map.googleMapsApiKey}&format=png&visual_refresh=true&markers=size:tiny|color:0xff0000|${config.map.homeLocation}&markers=size:mid|color:0xff0000|${itemLocation}">
              </a>
            </td></tr>`
        }

        html += `<tr><td>&nbsp;</td></tr>`;

        return html;
    }
}

function loadCheerio(html) {
    try {
        return cheerio.load(html);
    } catch (e) {
        console.error('cheerio is a failure :(');
    }
}

exports.Ad = Ad
