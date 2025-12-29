// 使用 VS Code 内置的 fetch，无需导入 node-fetch
declare const fetch: (url: string, options?: any) => Promise<any>;

// Google 翻译（目前使用 MyMemory 实现）
export async function googleTranslate(text: string, targetLang = 'en', sourceLang = 'zh-cn'): Promise<string> {
  // 直接使用 MyMemory 翻译
  return await myMemoryTranslate(text, targetLang, sourceLang);
}

// MyMemory 支持的语言代码映射
function mapToMyMemoryLangCode(langCode: string): string {
  const lowerCode = langCode.toLowerCase();

  // 特殊语言代码映射（基于验证测试结果）
  const langMapping: { [key: string]: string } = {
    'zh-cn': 'zh-CN',
    'zh': 'zh-CN',
    // 菲律宾语：优先使用 tl-PH 格式（RFC3066 标准）
    'tl': 'tl-PH',        // Tagalog -> Tagalog (Philippines) ✓
    'fil': 'fil',         // Filipino (小写) ✓
    'tagalog': 'tl-PH',   // 全名映射
    'filipino': 'fil',    // 全名映射到小写 fil
    // 孟加拉语：优先使用 bn-BD 格式（RFC3066 标准，孟加拉国）
    'bn': 'bn-BD',        // Bengali -> Bengali (Bangladesh) ✓
    'bengali': 'bn-BD'    // 全名映射
  };

  // 如果有映射，使用映射后的代码
  if (langMapping[lowerCode]) {
    return langMapping[lowerCode];
  }

  // 检查是否是标准的 xx-XX 格式（如 en-US, zh-CN）
  if (/^[a-z]{2}-[a-z]{2}$/i.test(langCode)) {
    // 转换为标准格式：前两位小写，后两位大写
    const parts = langCode.toLowerCase().split('-');
    return `${parts[0]}-${parts[1].toUpperCase()}`;
  }

  // 默认：两字母代码转小写，其他保持原样
  if (/^[a-z]{2}$/i.test(langCode)) {
    return langCode.toLowerCase();
  }

  return langCode;
}

// MyMemory 免费翻译API
export async function myMemoryTranslate(text: string, targetLang = 'en', sourceLang = 'zh-cn'): Promise<string> {
  const sourceLangCode = mapToMyMemoryLangCode(sourceLang);
  const targetLangCode = mapToMyMemoryLangCode(targetLang);
  const langPair = `${sourceLangCode}|${targetLangCode}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`MyMemory API error: ${response.status}`);

  const data: any = await response.json();

  // 检查是否有错误信息
  if (data.responseStatus === 403) {
    throw new Error(`翻译语言不支持: ${targetLangCode}`);
  }

  if (data.responseStatus === 200 && data.responseDetails) {
    // 检查是否有错误详情
    if (data.responseDetails.includes('INVALID TARGET LANGUAGE') ||
      data.responseDetails.includes('INVALID SOURCE LANGUAGE')) {
      throw new Error(`无效的语言代码: ${langPair}`);
    }
  }

  if (!data.responseData || !data.responseData.translatedText) {
    throw new Error('翻译服务无响应或返回空结果');
  }

  // 检查翻译结果是否包含错误信息
  const translatedText = data.responseData.translatedText;
  if (translatedText.includes('INVALID TARGET LANGUAGE') ||
    translatedText.includes('INVALID SOURCE LANGUAGE') ||
    translatedText.includes('LANGPAIR=')) {
    throw new Error(`翻译失败: ${translatedText}`);
  }

  return translatedText;
}

// 统一翻译接口（直接使用 MyMemory）
export async function translateWithFallback(text: string, targetLang = 'en', sourceLang = 'zh-cn'): Promise<{ text: string, service: string }> {
  try {
    const result = await myMemoryTranslate(text, targetLang, sourceLang);

    if (result && result.trim() && result !== 'undefined') {
      // 检查结果是否包含错误信息
      if (result.includes('INVALID TARGET LANGUAGE') ||
        result.includes('INVALID SOURCE LANGUAGE') ||
        result.includes('LANGPAIR=')) {
        throw new Error(`翻译服务返回错误: ${result}`);
      }

      // 直接返回 MyMemory 服务标识
      return { text: result, service: 'mymemory' };
    }

    throw new Error('翻译结果为空');
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    throw new Error(`翻译失败: ${errorMsg}`);
  }
} 