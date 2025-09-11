import { type Data, type DataItem, type Route, ViewType } from '@/types';
import { load } from 'cheerio';
import puppeteer from '@/utils/puppeteer';
import cache from '@/utils/cache';
import { parseDate, parseRelativeDate } from '@/utils/parse-date';
import { type Context } from 'hono';

const handler = async (ctx: Context): Promise<Data> => {
    const baseUrl = 'https://tech.163.com';
    const techUrl = baseUrl;
    
    const browser = await puppeteer();
    const page = await browser.newPage();
    
    try {
        await page.goto(techUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait for the news list to load
        await page.waitForSelector('.newsdata_wrap', { timeout: 10000 });
        
        const html = await page.content();
        await browser.close();
        
        const $ = load(html);
        const items = [];
        
        $('.newsdata_wrap .newsdata_list .data_row.news_article').each((_, element) => {
            const $item = $(element);
            
            const titleElement = $item.find('.news_title h3 a');
            const imageElement = $item.find('.na_pic img');
            const categoryElement = $item.find('.news_tag .barlink a');
            const timeElement = $item.find('.news_tag .time');
            
            const title = titleElement.text().trim();
            const link = titleElement.attr('href');
            const image = imageElement.attr('src');
            const category = categoryElement.text().trim();
            const timeText = timeElement.text().trim();
            
            if (title && link) {
                // Parse relative time using RSSHub utility
                const parsedDate = parseRelativeDate(timeText);
                const pubDate = parsedDate instanceof Date ? parsedDate : parseDate(timeText);
                
                items.push({
                    title,
                    link: link.startsWith('http') ? link : `https:${link}`,
                    description: image ? `<img src="${image}" alt="${title}"><br>${title}` : title,
                    author: '网易科技',
                    pubDate: pubDate.toUTCString(),
                    guid: link,
                });
            }
        });
        
        return {
            title: '网易科技',
            link: techUrl,
            description: '网易科技频道最新资讯',
            item: items,
        };
    } catch (error) {
        await browser.close();
        throw error;
    }
};

export const route: Route = {
    path: '/tech',
    name: '网易科技',
    maintainers: ['user'],
    handler,
    example: '/163/tech',
    categories: ['new-media', 'popular'],
    features: {
        requireConfig: false,
        requirePuppeteer: true,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    description: `网易科技频道`,
    radar: [
        {
            source: ['tech.163.com/'],
            target: '/163/tech',
        },
    ],
    view: ViewType.Articles,
};
