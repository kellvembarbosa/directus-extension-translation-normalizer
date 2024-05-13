import { defineHook } from '@directus/extensions-sdk';
import type { Application } from 'express';

export default defineHook(({ filter, init }, { env }) => {
	init('middlewares.after', ({ app }: Record<'app', Application>) => {
		app.use((_req, _res, next) => {

			if (_req.method == "GET" && _req.query.locale !== undefined) {
				console.log("=========> Middleware before hook called for normalize translations: <=========");

				// check method is GET or POST
				const localeValue = _req.query.locale as string | undefined
				const fallbackLocaleValue = _req.query.fallbackLocale as string | undefined
				const localizationFields = _req.query.localizationFields as string | undefined
				const replaceLinkedFields = _req.query.replaceLinkedFields as string | undefined
				const enablePrimaryFieldId = _req.query.enablePrimaryFieldId as string | undefined
				const omitSourceLocalizationField = _req.query.omitSourceLocalizationField as string | undefined
				const useGenericLocale = _req.query.useGenericLocale as string | undefined;
				
				// @ts-ignore
				_req.accountability = {
					// @ts-ignore
					..._req.accountability,
					locale: localeValue,
					fallbackLocale: fallbackLocaleValue,
					omitSourceLocalizationField: omitSourceLocalizationField == undefined ? true : omitSourceLocalizationField === "true",
					enablePrimaryFieldId: enablePrimaryFieldId == undefined ? true : enablePrimaryFieldId === "true",
					replaceLinkedFields: replaceLinkedFields === "true",
					localizationFields: JSON.stringify(localizationFields == undefined ? { default: ["translations"] } : JSON.parse(localizationFields)),
					useGenericLocale: useGenericLocale === "true",
				};
				next();
			} else {
				next();
			}
		});
	});

	// This hook is called when a new item is created
	filter('*.items.read', async (payload, meta, context : any) => {
		
		const { accountability } = context;
		if (accountability == undefined || accountability == null || accountability.locale == undefined) return payload;
		const { collection } = meta;

		const collectionName = collection.toString();
		if (collectionName.includes("directus_")) return payload;

		const { locale, fallbackLocale, omitSourceLocalizationField, enablePrimaryFieldId, replaceLinkedFields, localizationFields, useGenericLocale }: any = accountability;

		// Extract the translation data
		const localizationData = new LocalizationManager({
			enablePrimaryFieldId: enablePrimaryFieldId,
			replaceLinkedFields,
			localizationFields: JSON.parse(localizationFields),
			omitSourceLocalizationField,
			languageCodeKey: env.TN_LANGUAGE_CODE_KEY ?? "languages_code",
			locale,
			fallbackLocale,
			useGenericLocale
		});

		const processedData = localizationData.process(payload);
		return processedData;
	});
});

interface LocalizationManagerOptions {
	enablePrimaryFieldId?: boolean;
	replaceLinkedFields?: boolean;
	localizationFields?: Record<string, string[]>;
	omitSourceLocalizationField?: boolean;
	fallbackLocale?: string;
	locale?: string;
	languageCodeKey?: string;
	useGenericLocale?: boolean;
}

class LocalizationManager {
	private enablePrimaryFieldId: boolean;
	private replaceLinkedFields: boolean;
	private localizationFields: Record<string, string[]>;
	private omitSourceLocalizationField: boolean;
	private resultCache: Map<object, object>;
	private fallbackLocale: string | undefined;
	private locale?: string;
	private languageCodeKey: string;
	private useGenericLocale: boolean;

	constructor({
		enablePrimaryFieldId = true,
		replaceLinkedFields = false,
		localizationFields = { default: ["translations"] },
		omitSourceLocalizationField = true,
		fallbackLocale,
		locale = "en-US",
		languageCodeKey = "languages_code",
		useGenericLocale = false
	}: LocalizationManagerOptions = {}) {
		this.enablePrimaryFieldId = enablePrimaryFieldId;
		this.replaceLinkedFields = replaceLinkedFields;
		this.localizationFields = localizationFields;
		this.omitSourceLocalizationField = omitSourceLocalizationField;
		this.resultCache = new Map();
		this.locale = locale;
		this.fallbackLocale = fallbackLocale;
		this.languageCodeKey = languageCodeKey;
		this.useGenericLocale = useGenericLocale;
	}

	public setLocale(value: string): this {
		this.locale = value;
		return this;
	}

	public setFallbackLocale(value: string): this {
		this.fallbackLocale = value;
		return this;
	}


	public setEnablePrimaryFieldId(value: boolean): this {
		this.enablePrimaryFieldId = value;
		return this;
	}

	public setReplaceLinkedFields(value: boolean): this {
		this.replaceLinkedFields = value;
		return this;
	}

	public setLocalizationFields(value: Record<string, string[]>): this {
		this.localizationFields = value;
		return this;
	}

	public setOmitSourceLocalizationField(value: boolean): this {
		this.omitSourceLocalizationField = value;
		return this;
	}

	public setGenericLocale(value: boolean): this {
		this.useGenericLocale = value;
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
			const translationKeys = this.localizationFields[level] || this.localizationFields["default"];

			translationKeys?.forEach(key => {
				const translations = obj[key];

				const primaryTranslation = this.findBestMatch(translations, this.locale) //translations?.find((t: any) => t[this.languageCodeKey] === this.locale);

				const fallbackTranslation = this.fallbackLocale ? translations?.find((t: any) => t[this.languageCodeKey] === this.fallbackLocale) : undefined;
				const translation = primaryTranslation || fallbackTranslation;


				// console.log(translations);

				if (translation) {
					const { id, ...translationWithoutId } = translation;
					Object.assign(result, this.enablePrimaryFieldId ? translationWithoutId  : { ...translation });
					if (this.replaceLinkedFields) {
						Object.keys(result).forEach(k => {
							if (key.includes(k)) keysToRemove.push(k);
						});
					}

					if (this.omitSourceLocalizationField) {
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

	private normalizeLocaleCode(locale: string | undefined): string {

			if (!locale) return "";

			const normalized = locale.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();

			if (this.useGenericLocale) {
					return normalized.substring(0, normalized.length === 5 ? 3 : 2);
			}
			return normalized;
	}

	private findBestMatch(translations: any[], locale: string | undefined): any {
			if (!translations) return undefined;
			
			const normalizedLocale = this.normalizeLocaleCode(locale);
			return translations.find(t => this.normalizeLocaleCode(t[this.languageCodeKey]) === normalizedLocale);
	}
}