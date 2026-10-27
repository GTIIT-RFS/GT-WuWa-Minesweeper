export const AUDIO_LABELS = {
  click: '按钮点击',
  reveal: '翻开方格',
  flag: '插旗',
  warning: '触雷预警',
  boom: '土豆爆炸',
  win: '游戏胜利',
  timeout: '倒计时结束',
} as const;
export type SoundKey = keyof typeof AUDIO_LABELS;
export function openAssets(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gt-wuwa-assets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开素材库，请允许浏览器存储。'));
  });
}
export async function readAssets(): Promise<Record<string, Blob>> {
  const db = await openAssets();
  return new Promise((resolve, reject) => {
    const values: Record<string, Blob> = {};
    const tx = db.transaction('files', 'readonly');
    const cursor = tx.objectStore('files').openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        if (c.value instanceof Blob) values[String(c.key)] = c.value;
        c.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(values);
    };
    tx.onerror = () => {
      db.close();
      reject(new Error('读取素材失败。'));
    };
  });
}
export async function writeAsset(key: string, file?: Blob): Promise<void> {
  const db = await openAssets();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    if (file) tx.objectStore('files').put(file, key);
    else tx.objectStore('files').delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('素材保存失败：存储空间可能已满。请删除部分素材后重试。'));
    };
  });
}
export async function validateMedia(file: File, audio: boolean) {
  const allowed = audio
    ? ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg']
    : ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type))
    throw new Error(
      audio ? '请选择 MP3、WAV 或 OGG 音频。' : '请选择 PNG、JPG、WebP 或 GIF 图片。',
    );
  if (!file.size || file.size > (audio ? 10 : 5) * 1024 * 1024)
    throw new Error(`文件不能为空，且不能超过 ${audio ? 10 : 5} MB。`);
  if (!audio) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth * img.naturalHeight > 25_000_000)
        throw new Error('图片像素过大，请缩小到 2500 万像素以内。');
    } catch {
      throw new Error('图片无法解码或像素过大，请换一张图片。');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
