import axios from 'axios';
import * as cheerio from 'cheerio';
import { ProdutoUniversal } from '../domain/produto-universal';

export type MarketplaceOrigin = 'shopee' | 'mercado_livre';

export interface ParserResult {
  origin: MarketplaceOrigin;
  product: ProdutoUniversal;
}

export class MarketplaceUrlResolver {
  static resolve(url: string): MarketplaceOrigin {
    const normalizedUrl = String(url || '').toLowerCase();

    if (normalizedUrl.includes('shopee.')) {
      return 'shopee';
    }

    if (normalizedUrl.includes('mercadolivre.') || normalizedUrl.includes('mercadolibre.')) {
      return 'mercado_livre';
    }

    throw new Error('Marketplace não suportado para importação por URL.');
  }
}

export interface HtmlFetcher {
  fetch(url: string): Promise<string>;
}

export class AxiosHtmlFetcher implements HtmlFetcher {
  async fetch(url: string): Promise<string> {
    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 IntelliStock Hub Importer'
      },
      timeout: 15000
    });

    return response.data;
  }
}

export class GenericMarketplaceParser {
  constructor(private readonly fetcher: HtmlFetcher = new AxiosHtmlFetcher()) {}

  async parse(url: string): Promise<ParserResult> {
    const origin = MarketplaceUrlResolver.resolve(url);
    const html = await this.fetcher.fetch(url);
    const product = this.parseHtml(origin, html, url);

    return { origin, product };
  }

  private parseHtml(origin: MarketplaceOrigin, html: string, url: string): ProdutoUniversal {
    const $ = cheerio.load(html);
    const title = this.findFirstContent($, [
      'meta[property="og:title"]',
      'h1[data-testid="product-title"]',
      'h1.ui-pdp-title'
    ]);
    const priceText = this.findFirstContent($, [
      'meta[property="product:price:amount"]',
      '[data-testid="price-value"]',
      '.andes-money-amount__fraction'
    ]);
    const image = this.findFirstContent($, [
      'meta[property="og:image"]',
      'img[data-testid="hero-image"]',
      '.ui-pdp-gallery__figure img'
    ], 'src');
    const description = this.findFirstContent($, [
      'meta[property="og:description"]',
      '[data-testid="product-description"]',
      '.ui-pdp-description__content'
    ]);

    return {
      id_interno: `${origin}:${Buffer.from(url).toString('base64url')}`,
      sku: `${origin.toUpperCase()}-IMPORT-${Date.now()}`,
      titulo: title || 'Produto importado sem título',
      descricao: description || '',
      preco: this.parsePrice(priceText),
      estoque: 0,
      imagens: image ? [image] : [],
      variacoes: [],
      categorias: [],
      metadata: {
        source_url: url,
        import_origin: origin,
        import_mode: 'scraping'
      }
    };
  }

  private findFirstContent($: cheerio.CheerioAPI, selectors: string[], attribute = 'content'): string {
    for (const selector of selectors) {
      const element = $(selector).first();
      if (!element.length) {
        continue;
      }

      const content = attribute === 'text' ? element.text() : element.attr(attribute) || element.text();
      const normalized = String(content || '').trim();
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private parsePrice(rawValue: string): number {
    if (!rawValue) {
      return 0;
    }

    const normalized = rawValue
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

export class PuppeteerFallbackNote {
  static whenToUse(): string {
    return 'Use Puppeteer ou Playwright quando a página carregar os dados só após hidratação de SPA, bloqueando Axios + Cheerio.';
  }
}