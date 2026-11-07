export const WHALE_SKINS = [
  { id: 'classic', name: '原版蓝鲸' },
  { id: 'star-wish', name: '星愿' },
  { id: 'seigaiha', name: '青海波' },
  { id: 'sakura', name: '樱吹雪' },
  { id: 'kintsugi', name: '青瓷金继' },
  { id: 'festival', name: '夏夜祭' },
  { id: 'pumpkin', name: '南瓜魔女' },
  { id: 'sugar-skull', name: '糖果骷髅' },
  { id: 'bioluminescence', name: '深海磷光' },
  { id: 'coral-sunset', name: '珊瑚日落' },
  { id: 'gold-lacquer', name: '墨金漆器' },
  { id: 'prism', name: '琉璃棱彩' },
  { id: 'felt', name: '羊毛毡' },
  { id: 'paper-moon', name: '叠纸月船' },
] as const;

export type WhaleSkin = typeof WHALE_SKINS[number]['id'];

export function normalizeWhaleSkin(value: unknown): WhaleSkin {
  return WHALE_SKINS.find(skin => skin.id === value)?.id ?? 'classic';
}
