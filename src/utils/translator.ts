import fetch from 'node-fetch';

// Google 翻译（需第三方包，暂用 MyMemory 兜底）
export async function googleTranslate(text: string, targetLang = 'en', sourceLang = 'zh-cn'): Promise<string> {
  // 这里可集成 @vitalets/google-translate-api 或其他服务
  // 目前用 MyMemory 兜底
  return myMemoryTranslate(text, targetLang, sourceLang);
}

// MyMemory 免费翻译API
export async function myMemoryTranslate(text: string, targetLang = 'en', sourceLang = 'zh-cn'): Promise<string> {
  const sourceLangCode = sourceLang === 'zh-cn' ? 'zh-CN' : sourceLang.toUpperCase();
  const targetLangCode = targetLang.toUpperCase();
  const langPair = `${sourceLangCode}|${targetLangCode}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MyMemory API error: ${response.status}`);
  const data: any = await response.json();
  if (!data.responseData || !data.responseData.translatedText) throw new Error('Invalid MyMemory response');
  return data.responseData.translatedText;
}

// 统一翻译接口（支持多服务自动切换）
export async function translateWithFallback(text: string, targetLang = 'en', sourceLang = 'zh-cn'): Promise<{ text: string, service: string }> {
  const services = ['google', 'mymemory']; // 可扩展
  for (const service of services) {
    try {
      let result = '';
      if (service === 'google') result = await googleTranslate(text, targetLang, sourceLang);
      else if (service === 'mymemory') result = await myMemoryTranslate(text, targetLang, sourceLang);
      if (result && result.trim() && result !== 'undefined') {
        return { text: result, service };
      }
    } catch (e) {
      continue;
    }
  }
  return { text: '', service: 'none' };
} 