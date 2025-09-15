import { type Data, type DataItem, type Route, ViewType } from '@/types';
import { load } from 'cheerio';
import puppeteer from '@/utils/puppeteer';
import cache from '@/utils/cache';
import { parseDate, parseRelativeDate } from '@/utils/parse-date';
import { type Context } from 'hono';
import ofetch from '@/utils/ofetch';

// Custom fulltext extraction function for 163 articles
const fetch163Article = async (item: DataItem): Promise<DataItem> => {
    return cache.tryGet(`163-article-${item.link}`, async () => {
        try {
            const response = await ofetch(item.link as string);
            const $ = load(response);
            
            // Target the div.post_body element specifically
            const postBodyElement = $('div.post_body');
            
            if (postBodyElement.length > 0) {
                // Clone the element to avoid modifying the original DOM
                const $content = postBodyElement.clone();
                
                // Remove unwanted elements from within post_body
                $content.find('script, style').remove();
                $content.find('.ad, .advertisement, [class*="ad"], [id*="ad"]').remove();
                $content.find('.share, .related, .recommend, .comment').remove();
                $content.find('.copyright, .article-copyright').remove();
                $content.find('[class*="share"], [class*="recommend"]').remove();
                $content.find('.netease-ads, [class*="netease-ad"]').remove();
                
                // Get the cleaned HTML content
                const cleanedContent = $content.html();
                
                if (cleanedContent && cleanedContent.trim().length > 0) {
                    return {
                        ...item,
                        description: cleanedContent,
                    };
                }
            }
            
            // Fallback: if div.post_body not found, return original item
            return item;
        } catch (error) {
            // If extraction fails, return original item
            return item;
        }
    });
};

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

        const shouldFetchFulltext = ctx.req.query('fulltext') === 'true' || ctx.req.query('mode')?.toLowerCase() === 'fulltext';
        const finalItems = shouldFetchFulltext 
            ? await Promise.all(items.map(item => fetch163Article(item)))
            : items;

        if (shouldFetchFulltext) {
            finalItems.forEach(item => {
                (item as any)._customFulltext = true;
            });
        }

        return {
            title: '网易科技',
            link: techUrl,
            description: '网易科技频道最新资讯',
            item: finalItems,
        };
    } catch (error) {
        await browser.close();
        throw error;
    }
};

export const route: Route = {
    path: '/news/tech',
    name: '网易科技',
    maintainers: ['user'],
    handler,
    example: '/163/news/tech',
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
    description: `网易科技频道

支持全文输出，使用以下任一参数获取完整文章内容：
- \`fulltext=true\`：\`/163/news/tech?fulltext=true\`
- \`mode=fulltext\`：\`/163/news/tech?mode=fulltext\`

该路由使用自定义内容提取，专门针对网易网页结构优化，提供更干净的文章内容。`,
    radar: [
        {
            source: ['tech.163.com/'],
            target: '/163/news/tech',
        },
    ],
    view: ViewType.Articles,
};
