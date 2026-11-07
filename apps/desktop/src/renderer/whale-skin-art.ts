import type { WhaleSkin } from '../shared/whale-skins';

// The artwork uses the original 24-unit logo coordinates with room for ornaments.
export const WHALE_SKIN_BOUNDS = [-4, -5.5, 33, 30] as const;

export const whaleSkinSources: Record<Exclude<WhaleSkin, 'classic'>, string> = {
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
