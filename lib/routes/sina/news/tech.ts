import { type Data, type DataItem, type Route, ViewType } from '@/types';
import { load } from 'cheerio';
import puppeteer from '@/utils/puppeteer';
import { parseRelativeDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';
import dayjs from 'dayjs';
import { type Context } from 'hono';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

// Custom fulltext extraction function for Sina articles
const fetchSinaArticle = async (item: DataItem): Promise<DataItem> => {
    return cache.tryGet(`sina-article-${item.link}`, async () => {
        try {
            const response = await ofetch(item.link as string);
            const $ = load(response);
            
            // Target the #artibody element specifically and get only its direct content
            const artibodyElement = $('#artibody');
            
            if (artibodyElement.length > 0) {
                // Clone the element to avoid modifying the original DOM
                const $content = artibodyElement.clone();
                
                // Remove unwanted elements from within artibody
                $content.find('script, style').remove();
                $content.find('.ad, .advertisement, [class*="ad"], [id*="ad"]').remove();
                $content.find('.share, .related, .recommend, .comment').remove();
                $content.find('.img_wrapper, .ct_hqimg, .hqimg_wrapper').remove(); // Remove stock chart wrappers
                $content.find('.article-copyright, .copyright').remove();
                $content.find('[class*="share"], [class*="recommend"]').remove();
                $content.find('.sinaads, [class*="sina-ads"]').remove();
                
                // Get the cleaned HTML content
                const cleanedContent = $content.html();
                
                if (cleanedContent && cleanedContent.trim().length > 0) {
                    return {
                        ...item,
                        description: cleanedContent,
                    };
                }
            }
            
            // Fallback: if #artibody not found, return original item
            return item;
        } catch (error) {
            // If extraction fails, return original item
            return item;
        }
    });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const handler = async (ctx: Context): Promise<Data> => {
    const baseUrl = 'https://tech.sina.com.cn';
    const techUrl = baseUrl;

    const browser = await puppeteer();
    const page = await browser.newPage();

    try {
        await page.goto(techUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // Wait for the news list to load
        await page.waitForSelector('.feed_card.ty-feed-card-container', { timeout: 10000 });

        const html = await page.content();
        await browser.close();

        const $ = load(html);
        const items: DataItem[] = [];

        // Custom date parser for Sina's Chinese date formats
        const parseSinaDate = (timeText: string): Date => {
            if (!timeText) {
                return new Date();
            }

            const now = dayjs();

            // Handle "今天 HH:MM" format
            const todayMatch = timeText.match(/^今天\s+(\d{1,2}):(\d{2})$/);
            if (todayMatch) {
                const [, hour, minute] = todayMatch;
                return now.hour(Number.parseInt(hour)).minute(Number.parseInt(minute)).second(0).millisecond(0).toDate();
            }

            // Handle "M月D日 HH:MM" format (current year)
            const monthDayMatch = timeText.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
            if (monthDayMatch) {
                const [, month, day, hour, minute] = monthDayMatch;
                const date = now
                    .month(Number.parseInt(month) - 1)
                    .date(Number.parseInt(day))
                    .hour(Number.parseInt(hour))
                    .minute(Number.parseInt(minute))
                    .second(0)
                    .millisecond(0);

                // If the date is in the future, assume it's from last year
                if (date.isAfter(now)) {
                    return date.subtract(1, 'year').toDate();
                }
                return date.toDate();
            }

            // Fallback to parseRelativeDate for other formats
            const parsedDate = parseRelativeDate(timeText);
            return parsedDate instanceof Date ? parsedDate : new Date();
        };

        // Use more specific selector to avoid duplicates and ensure we get unique items
        const seenLinks = new Set<string>();

        $('.feed_card.ty-feed-card-container .ty-card').each((_, element) => {
            const $item = $(element);

            const titleElement = $item.find('.ty-card-tt a');
            const linkElement = $item.find('.ty-card-tt a');
            const imageElement = $item.find('.ty-card-thumb');
            const timeElement = $item.find('.ty-card-time');

            const title = titleElement.text().trim();
            const link = linkElement.attr('href');
            const image = imageElement.attr('src');
            const timeText = timeElement.text().trim();

            if (title && link && !seenLinks.has(link)) {
                const fullLink = link.startsWith('http') ? link : `https:${link}`;
                
                if (!fullLink.startsWith('https://finance.sina.com.cn/')) {
                    return; // Skip non-finance items
                }
                
                seenLinks.add(link);

                const pubDate = parseSinaDate(timeText);

                items.push({
                    title,
                    link: fullLink,
                    description: image ? `<img src="${image}" alt="${title}"><br>${title}` : title,
                    author: '新浪科技',
                    pubDate: timezone(pubDate, 8).toUTCString(),
                    guid: link,
                });
            }
        });

        const shouldFetchFulltext = ctx.req.query('fulltext') === 'true' || ctx.req.query('mode')?.toLowerCase() === 'fulltext';
        const finalItems = shouldFetchFulltext 
            ? await Promise.all(items.map(item => fetchSinaArticle(item)))
            : items;

        if (shouldFetchFulltext) {
            finalItems.forEach(item => {
                (item as any)._customFulltext = true;
            });
        }

        return {
            title: '新浪科技',
            link: techUrl,
            description: '新浪科技频道最新资讯',
            item: finalItems,
        };
    } catch (error) {
        await browser.close();
        throw error;
    }
};

export const route: Route = {
    path: '/news/tech',
    name: '新浪科技',
    maintainers: ['user'],
    handler,
    example: '/sina/news/tech',
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
    description: `新浪科技频道
- \`mode=fulltext\`：\`/sina/news/tech?mode=fulltext\``,
    radar: [
        {
            source: ['tech.sina.com.cn/'],
            target: '/sina/news/tech',
        },
    ],
    view: ViewType.Articles,
};
