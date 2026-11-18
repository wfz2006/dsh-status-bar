import type { WhaleSkin } from '../shared/whale-skins';

// The artwork uses the original 24-unit logo coordinates with room for ornaments.
export const WHALE_SKIN_BOUNDS = [-4, -5.5, 33, 30] as const;

const vectorSkins = {
  'star-wish': new URL('./assets/whale-skins/star-wish.svg', import.meta.url).href,
  seigaiha: new URL('./assets/whale-skins/seigaiha.svg', import.meta.url).href,
  sakura: new URL('./assets/whale-skins/sakura.svg', import.meta.url).href,
  kintsugi: new URL('./assets/whale-skins/kintsugi.svg', import.meta.url).href,
  festival: new URL('./assets/whale-skins/festival.svg', import.meta.url).href,
  pumpkin: new URL('./assets/whale-skins/pumpkin.svg', import.meta.url).href,
  'sugar-skull': new URL('./assets/whale-skins/sugar-skull.svg', import.meta.url).href,
  bioluminescence: new URL('./assets/whale-skins/bioluminescence.svg', import.meta.url).href,
  'coral-sunset': new URL('./assets/whale-skins/coral-sunset.svg', import.meta.url).href,
  'gold-lacquer': new URL('./assets/whale-skins/gold-lacquer.svg', import.meta.url).href,
  prism: new URL('./assets/whale-skins/prism.svg', import.meta.url).href,
  felt: new URL('./assets/whale-skins/felt.svg', import.meta.url).href,
  'paper-moon': new URL('./assets/whale-skins/paper-moon.svg', import.meta.url).href,
};

export const whaleSkinSources: Record<Exclude<WhaleSkin, 'classic'>, string> = {
  starlit: new URL('./assets/whale-skins/starlit.png', import.meta.url).href,
  sailor: new URL('./assets/whale-skins/sailor.png', import.meta.url).href,
  ...vectorSkins,
};

const materialOrder = Object.keys(vectorSkins).sort();
const materialUrl = new URL('./assets/whale-eyelid-materials.png', import.meta.url).href;
let materialSheet: Promise<HTMLImageElement> | undefined;
async function decode(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
async function eyelidMaterial(skin: WhaleSkin) {
  const column = materialOrder.indexOf(skin);
  if (column < 0) return null;
  const pending = materialSheet ??= decode(materialUrl);
  const sheet = await pending.catch(() => {
    if (pending === materialSheet) materialSheet = undefined;
    return null;
  });
  if (!sheet) return null;
  const tile = document.createElement('canvas');
  tile.width = sheet.naturalWidth / materialOrder.length;
  tile.height = sheet.naturalHeight;
  const ctx = tile.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(sheet, column*tile.width, 0, tile.width, tile.height, 0, 0, tile.width, tile.height);
  return tile;
}
export function loadWhaleSkin(skin: Exclude<WhaleSkin, 'classic'>) {
  return Promise.all([decode(whaleSkinSources[skin]), eyelidMaterial(skin)]);
}
