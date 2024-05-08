import { defineHook } from '@directus/extensions-sdk';
import type { Application } from 'express';

export default defineHook((register, { env }) => {

	const { filter, init } = register;

	init('middlewares.after', ({ app }: Record<'app', Application>) => {
		app.use((_req, _res, next) => {
			console.log("=========> Middleware before hook called: <=========");

			// check method is GET or POST
			const localeValue = _req.method === "GET" ? _req.query.locale as string | undefined : _req.body.locale as string | undefined;
			const fallbackLocaleValue = _req.method === "GET" ? _req.query.fallbackLocale as string | undefined : _req.body.fallbackLocale as string | undefined;

			// @ts-ignore
			_req.accountability = {
				// @ts-ignore
				..._req.accountability,
				locale: localeValue,
				fallbackLocale: fallbackLocaleValue
			};

			next();
		});
	});

	// This hook is called when a new item is created
	filter('*.items.read', async (payload, meta, context) => {

		const { accountability } = context;
		const { locale, fallbackLocale }: any = accountability;
		const { collection } = meta;

		console.log("Read hook called for collection: ", collection);
		console.log("locale: ", locale);
		console.log("fallbackLocale: ", fallbackLocale);

		const collectionName = collection.toString();
		if (collectionName.includes("directus_") || !locale) return payload;

		// Extract the translation data
		const extractor = new TranslationExtractor({
			replaceIdField: false,
			replaceOtherFields: false,
			translationKeys: { default: ["translations"] },
			removeOriginalTranslationKey: true,
			languageCodeKey: env.TN_LANGUAGE_CODE_KEY ?? "languages_code",
			locale,
			fallbackLocale
		});

		const processedData = extractor.process(payload);
		return processedData;
	});


});

interface TranslationExtractorOptions {
	replaceIdField?: boolean;
	replaceOtherFields?: boolean;
	translationKeys?: Record<string, string[]>;
	removeOriginalTranslationKey?: boolean;
	fallbackLocale?: string;
	locale?: string;
	languageCodeKey?: string;
}

class TranslationExtractor {
	private replaceIdField: boolean;
	private replaceOtherFields: boolean;
	private translationKeys: Record<string, string[]>;
	private removeOriginalTranslationKey: boolean;
	private resultCache: Map<object, object>;
	private fallbackLocale: string | undefined;
	private locale?: string;
	private languageCodeKey: string;


	constructor({
		replaceIdField = true,
		replaceOtherFields = false,
		translationKeys = { default: ["translations"] },
		removeOriginalTranslationKey = true,
		fallbackLocale,
		locale = "en-US",
		languageCodeKey = "languages_code"
	}: TranslationExtractorOptions = {}) {
		this.replaceIdField = replaceIdField;
		this.replaceOtherFields = replaceOtherFields;
		this.translationKeys = translationKeys;
		this.removeOriginalTranslationKey = removeOriginalTranslationKey;
		this.resultCache = new Map();
		this.locale = locale;
		this.fallbackLocale = fallbackLocale;
		this.languageCodeKey = languageCodeKey;
	}

	public setLocale(value: string): this {
		this.locale = value;
		return this;
	}

	public setFallbackLocale(value: string): this {
		this.fallbackLocale = value;
		return this;
	}


	public setReplaceIdField(value: boolean): this {
		this.replaceIdField = value;
		return this;
	}

	public setReplaceOtherFields(value: boolean): this {
		this.replaceOtherFields = value;
		return this;
	}

	public setTranslationKeys(value: Record<string, string[]>): this {
		this.translationKeys = value;
		return this;
	}

	public setRemoveOriginalTranslationKey(value: boolean): this {
		this.removeOriginalTranslationKey = value;
		return this;
	}

	public process(data: any): any {
		return this.processObject(data, "default");
	}

	private processObject(obj: any, level: string): any {
		if (this.resultCache.has(obj)) {
			return this.resultCache.get(obj);
		}

		let result: any;
		if (Array.isArray(obj)) {
			result = obj.map(item => this.processObject(item, level));
		} else if (obj && typeof obj === "object") {
			result = { ...obj };
			let keysToRemove: string[] = [];
			const translationKeys = this.translationKeys[level] || this.translationKeys["default"];

			translationKeys?.forEach(key => {
				const translations = obj[key];

				const primaryTranslation = translations?.find((t: any) => t[this.languageCodeKey] === this.locale);

				const fallbackTranslation = this.fallbackLocale ? translations?.find((t: any) => t[this.languageCodeKey] === this.fallbackLocale) : undefined;
				const translation = primaryTranslation || fallbackTranslation;


				// console.log(translations);

				if (translation) {
					const { id, ...translationWithoutId } = translation;
					Object.assign(result, this.replaceIdField ? translationWithoutId : { ...translation });
					if (this.replaceOtherFields) {
						Object.keys(result).forEach(k => {
							if (key.includes(k)) keysToRemove.push(k);
						});
					}

					if (this.removeOriginalTranslationKey) {
						keysToRemove.push(key);
					}
				} else {
					keysToRemove.push(key);
				}
			});

			keysToRemove.forEach(key => delete result[key]);

			for (const key in result) {
				result[key] = this.processObject(result[key], key);
			}
		} else {
			result = obj;
		}

		this.resultCache.set(obj, result);
		return result;
	}
}

// Usage example:
// const extractor = new TranslationExtractor({
//     replaceIdField: true,
//     replaceOtherFields: false,
//     translationKeys: { default: ["translations"], post: ["content_translations"] },
//     removeOriginalTranslationKey: true
// });

// const processedData = extractor.process(data);
