import { type Data, type DataItem, type Route, ViewType } from '@/types';
import { load } from 'cheerio';
import puppeteer from '@/utils/puppeteer';
import { parseRelativeDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';
import dayjs from 'dayjs';
import { type Context } from 'hono';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

// Custom fulltext extraction function for EET China articles
const fetchEETArticle = async (item: DataItem): Promise<DataItem> => {
    return cache.tryGet(`eet-article-${item.link}`, async () => {
        try {
            const response = await ofetch(item.link as string);
            const $ = load(response);

            // Target the div.article_body element specifically for EET China
            const articleContent = $('div.article_body').first();

            if (articleContent.length > 0) {
                // Clone the element to avoid modifying the original DOM
                const $content = articleContent.clone();

                // Remove unwanted elements
                $content.find('script, style').remove();
                $content.find('.ad, .advertisement, [class*="ad"], [id*="ad"]').remove();
                $content.find('.share, .related, .recommend, .comment').remove();
                $content.find('.social-share, .tags, .author-info').remove();

                // Get the cleaned HTML content
                const cleanedContent = $content.html();

                if (cleanedContent && cleanedContent.trim().length > 0) {
                    return {
                        ...item,
                        description: cleanedContent,
                    };
                }
            }

            // Fallback: if no content found, return original item
            return item;
        } catch (error) {
            // If extraction fails, return original item
            return item;
        }
    });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const handler = async (ctx: Context): Promise<Data> => {
    const baseUrl = 'https://www.eet-china.com';
    const newsUrl = `${baseUrl}/news/`;

    const browser = await puppeteer();
    const page = await browser.newPage();

    try {
        await page.goto(newsUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // Wait for the news list to load
        await page.waitForSelector('.new-art-list .art-l-ul.main_list', { timeout: 10000 });

        const html = await page.content();
        await browser.close();

        const $ = load(html);
        const items: DataItem[] = [];

        // Custom date parser for EET China's date format (YYYY-MM-DD)
        const parseEETDate = (timeText: string): Date => {
            if (!timeText) {
                return new Date();
            }

            // Handle "YYYY-MM-DD" format
            const dateMatch = timeText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (dateMatch) {
                const [, year, month, day] = dateMatch;
                return dayjs(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).toDate();
            }

            // Fallback to parseRelativeDate for other formats
            const parsedDate = parseRelativeDate(timeText);
            return parsedDate instanceof Date ? parsedDate : new Date();
        };

        // Use more specific selector to avoid duplicates and ensure we get unique items
        const seenLinks = new Set<string>();

        $('.new-art-list .art-l-ul.main_list .art-l-li').each((_, element) => {
            const $item = $(element);

            const titleElement = $item.find('.theword h4 a');
            const linkElement = $item.find('.theword h4 a');
            const imageElement = $item.find('.thepic img');
            const timeElement = $item.find('.m_newstime');
            const authorElement = $item.find('.m_writer');
            const descElement = $item.find('.m_thetext');

            const title = titleElement.text().trim();
            const link = linkElement.attr('href');
            let image = imageElement.attr('src') || imageElement.attr('data-original');
            // Handle protocol-relative URLs
            if (image && image.startsWith('//')) {
                image = `https:${image}`;
            }
            const timeText = timeElement.text().trim();
            const author = authorElement.text().trim();
            const description = descElement.text().trim();

            if (title && link && !seenLinks.has(link)) {
                const fullLink = link.startsWith('http') ? link : `${baseUrl}${link}`;

                seenLinks.add(link);

                const pubDate = parseEETDate(timeText);

                items.push({
                    title,
                    link: fullLink,
                    description: image ? `<img src="${image}" alt="${title}"><br>${description || title}` : (description || title),
                    author: author || 'EE Times China',
                    pubDate: timezone(pubDate, 8).toUTCString(),
                    guid: link,
                });
            }
        });

        const shouldFetchFulltext = ctx.req.query('fulltext') === 'true' || ctx.req.query('mode')?.toLowerCase() === 'fulltext';
        const finalItems = shouldFetchFulltext
            ? await Promise.all(items.map(item => fetchEETArticle(item)))
            : items;

        if (shouldFetchFulltext) {
            finalItems.forEach(item => {
                (item as any)._customFulltext = true;
            });
        }

        return {
            title: 'EE Times China 新闻',
            link: newsUrl,
            description: 'EE Times China 电子工程专辑最新资讯',
            item: finalItems,
        };
    } catch (error) {
        await browser.close();
        throw error;
    }
};

export const route: Route = {
    path: '/news',
    name: 'EE Times China 新闻',
    maintainers: ['user'],
    handler,
    example: '/eet-china/news',
    parameters: {},
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
    description: `EE Times China 电子工程专辑
- \`mode=fulltext\`：\`/eet-china/news?mode=fulltext\``,
    radar: [
        {
            source: ['www.eet-china.com/news/'],
            target: '/eet-china/news',
        },
    ],
    view: ViewType.Articles,
};