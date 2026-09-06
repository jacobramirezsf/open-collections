// Garment blanks usable as a canvas background, so a piece can be seen on the thing it would
// actually be printed on. Types follow the studio's own garment data.
export interface GarmentColor {
  slug: string
  name: string
  file: string
}

export interface GarmentProduct {
  id: string
  label: string
  colors: GarmentColor[]
}

export const GARMENTS: GarmentProduct[] = [
  {
    id: 'hoodie-heavy',
    label: 'Heavy fleece hoodie',
    colors: [
      { slug: 'army', name: "Army", file: 'hoodie-heavy/army.webp' },
      { slug: 'beige', name: "Beige", file: 'hoodie-heavy/beige.webp' },
      { slug: 'blackedge', name: "Blackedge", file: 'hoodie-heavy/blackedge.webp' },
      { slug: 'brass', name: "Brass", file: 'hoodie-heavy/brass.webp' },
      { slug: 'brightorange', name: "Brightorange", file: 'hoodie-heavy/brightorange.webp' },
      { slug: 'chocolate', name: "Chocolate", file: 'hoodie-heavy/chocolate.webp' },
      { slug: 'clove', name: "Clove", file: 'hoodie-heavy/clove.webp' },
      { slug: 'cobaltblue', name: "Cobaltblue", file: 'hoodie-heavy/cobaltblue.webp' },
      { slug: 'cream', name: "Cream", file: 'hoodie-heavy/cream.webp' },
      { slug: 'darkred', name: "Darkred", file: 'hoodie-heavy/darkred.webp' },
      { slug: 'dolphinblue', name: "Dolphinblue", file: 'hoodie-heavy/dolphinblue.webp' },
      { slug: 'ivy', name: "Ivy", file: 'hoodie-heavy/ivy.webp' },
      { slug: 'mushroom', name: "Mushroom", file: 'hoodie-heavy/mushroom.webp' },
      { slug: 'navy', name: "Navy", file: 'hoodie-heavy/navy.webp' },
      { slug: 'offblack', name: "Offblack", file: 'hoodie-heavy/offblack.webp' },
      { slug: 'patchouli', name: "Patchouli", file: 'hoodie-heavy/patchouli.webp' },
      { slug: 'rosequartz', name: "Rosequartz", file: 'hoodie-heavy/rosequartz.webp' },
      { slug: 'sage', name: "Sage", file: 'hoodie-heavy/sage.webp' },
      { slug: 'vintageblack', name: "Vintageblack", file: 'hoodie-heavy/vintageblack.webp' },
    ],
  },
  {
    id: 'hoodie-wash',
    label: 'Mineral wash hoodie',
    colors: [
      { slug: 'mineral-arctic', name: "Mineral Arctic", file: 'hoodie-wash/mineral-arctic.webp' },
      { slug: 'mineral-carbon', name: "Mineral Carbon", file: 'hoodie-wash/mineral-carbon.webp' },
      { slug: 'mineral-cocoa', name: "Mineral Cocoa", file: 'hoodie-wash/mineral-cocoa.webp' },
      { slug: 'mineral-icegrey', name: "Mineral Icegrey", file: 'hoodie-wash/mineral-icegrey.webp' },
      { slug: 'mineral-indigo', name: "Mineral Indigo", file: 'hoodie-wash/mineral-indigo.webp' },
      { slug: 'mineral-limestone', name: "Mineral Limestone", file: 'hoodie-wash/mineral-limestone.webp' },
      { slug: 'mineral-matcha', name: "Mineral Matcha", file: 'hoodie-wash/mineral-matcha.webp' },
    ],
  },
  {
    id: 'hoodie-mid',
    label: 'Midweight hoodie',
    colors: [
      { slug: 'ashheather', name: "Ashheather", file: 'hoodie-mid/ashheather.webp' },
      { slug: 'azure', name: "Azure", file: 'hoodie-mid/azure.webp' },
      { slug: 'black', name: "Black", file: 'hoodie-mid/black.webp' },
      { slug: 'cherry', name: "Cherry", file: 'hoodie-mid/cherry.webp' },
      { slug: 'clay', name: "Clay", file: 'hoodie-mid/clay.webp' },
      { slug: 'greyheather', name: "Greyheather", file: 'hoodie-mid/greyheather.webp' },
      { slug: 'honeydew', name: "Honeydew", file: 'hoodie-mid/honeydew.webp' },
      { slug: 'ivory', name: "Ivory", file: 'hoodie-mid/ivory.webp' },
      { slug: 'lime', name: "Lime", file: 'hoodie-mid/lime.webp' },
      { slug: 'magicblue', name: "Magicblue", file: 'hoodie-mid/magicblue.webp' },
      { slug: 'melon', name: "Melon", file: 'hoodie-mid/melon.webp' },
      { slug: 'navy', name: "Navy", file: 'hoodie-mid/navy.webp' },
      { slug: 'olive', name: "Olive", file: 'hoodie-mid/olive.webp' },
      { slug: 'orchid', name: "Orchid", file: 'hoodie-mid/orchid.webp' },
      { slug: 'pigmentblack', name: "Pigmentblack", file: 'hoodie-mid/pigmentblack.webp' },
      { slug: 'sand', name: "Sand", file: 'hoodie-mid/sand.webp' },
      { slug: 'seafoam', name: "Seafoam", file: 'hoodie-mid/seafoam.webp' },
      { slug: 'violet', name: "Violet", file: 'hoodie-mid/violet.webp' },
      { slug: 'watermelon', name: "Watermelon", file: 'hoodie-mid/watermelon.webp' },
    ],
  },
  {
    id: 'hoodie-premium',
    label: 'Heavyweight hoodie',
    colors: [
      { slug: 'black', name: "Black", file: 'hoodie-premium/black.webp' },
      { slug: 'brown', name: "Brown", file: 'hoodie-premium/brown.webp' },
      { slug: 'classic-navy', name: "Classic Navy", file: 'hoodie-premium/classic-navy.webp' },
      { slug: 'grey-heather', name: "Grey Heather", file: 'hoodie-premium/grey-heather.webp' },
      { slug: 'ivory', name: "Ivory", file: 'hoodie-premium/ivory.webp' },
      { slug: 'olive', name: "Olive", file: 'hoodie-premium/olive.webp' },
      { slug: 'pigmentblack', name: "Pigmentblack", file: 'hoodie-premium/pigmentblack.webp' },
      { slug: 'ind429hoodie-blue-magic', name: "Hoodie Blue Magic", file: 'hoodie-premium/ind429hoodie-blue-magic.webp' },
    ],
  },
  {
    id: 'hoodie-dripdye',
    label: 'Drip dye hoodie',
    colors: [
      { slug: 'black-camo', name: "Black Camo", file: 'hoodie-dripdye/black-camo.webp' },
      { slug: 'olive-camo', name: "Olive Camo", file: 'hoodie-dripdye/olive-camo.webp' },
    ],
  },
  {
    id: 'zip-heavy',
    label: 'Heavy fleece zip hood',
    colors: [
      { slug: 'ash', name: "Ash", file: 'zip-heavy/ash.webp' },
      { slug: 'navy', name: "Navy", file: 'zip-heavy/navy.webp' },
      { slug: 'white', name: "White", file: 'zip-heavy/white.webp' },
    ],
  },
  {
    id: 'zip-premium',
    label: 'Heavyweight zip hood',
    colors: [
      { slug: 'black', name: "Black", file: 'zip-premium/black.webp' },
      { slug: 'heather-grey', name: "Heather Grey", file: 'zip-premium/heather-grey.webp' },
      { slug: 'pigment-black', name: "Pigment Black", file: 'zip-premium/pigment-black.webp' },
    ],
  },
  {
    id: 'zip-mid',
    label: 'Midweight zip hood',
    colors: [
      { slug: 'ash', name: "Ash", file: 'zip-mid/ash.webp' },
      { slug: 'black', name: "Black", file: 'zip-mid/black.webp' },
    ],
  },
  {
    id: 'crewneck',
    label: 'Drip dye crewneck',
    colors: [
      { slug: 'black-camo', name: "Black Camo", file: 'crewneck/black-camo.webp' },
      { slug: 'olive-camo', name: "Olive Camo", file: 'crewneck/olive-camo.webp' },
    ],
  },
  {
    id: 'tee-dyed',
    label: 'Garment-dyed tee',
    colors: [
      { slug: 'army', name: "Army", file: 'tee-dyed/army.webp' },
      { slug: 'ash', name: "Ash", file: 'tee-dyed/ash.webp' },
      { slug: 'atlantic-green', name: "Atlantic Green", file: 'tee-dyed/atlantic-green.webp' },
      { slug: 'beige', name: "Beige", file: 'tee-dyed/beige.webp' },
      { slug: 'black-edge', name: "Black Edge", file: 'tee-dyed/black-edge.webp' },
      { slug: 'black', name: "Black", file: 'tee-dyed/black.webp' },
      { slug: 'blue-moon', name: "Blue Moon", file: 'tee-dyed/blue-moon.webp' },
      { slug: 'brass', name: "Brass", file: 'tee-dyed/brass.webp' },
      { slug: 'brightorange', name: "Brightorange", file: 'tee-dyed/brightorange.webp' },
      { slug: 'cement', name: "Cement", file: 'tee-dyed/cement.webp' },
      { slug: 'charcoal', name: "Charcoal", file: 'tee-dyed/charcoal.webp' },
      { slug: 'chocolate', name: "Chocolate", file: 'tee-dyed/chocolate.webp' },
      { slug: 'clear-blue', name: "Clear Blue", file: 'tee-dyed/clear-blue.webp' },
      { slug: 'clove', name: "Clove", file: 'tee-dyed/clove.webp' },
      { slug: 'cobaltblue', name: "Cobaltblue", file: 'tee-dyed/cobaltblue.webp' },
      { slug: 'creme', name: "Creme", file: 'tee-dyed/creme.webp' },
      { slug: 'dark-red', name: "Dark Red", file: 'tee-dyed/dark-red.webp' },
      { slug: 'dark-teal', name: "Dark Teal", file: 'tee-dyed/dark-teal.webp' },
      { slug: 'dolphinblue', name: "Dolphinblue", file: 'tee-dyed/dolphinblue.webp' },
      { slug: 'fuchsia', name: "Fuchsia", file: 'tee-dyed/fuchsia.webp' },
      { slug: 'gold', name: "Gold", file: 'tee-dyed/gold.webp' },
      { slug: 'ivy', name: "Ivy", file: 'tee-dyed/ivy.webp' },
      { slug: 'light-blue', name: "Light Blue", file: 'tee-dyed/light-blue.webp' },
      { slug: 'light-grey', name: "Light Grey", file: 'tee-dyed/light-grey.webp' },
      { slug: 'lotus', name: "Lotus", file: 'tee-dyed/lotus.webp' },
      { slug: 'mauve', name: "Mauve", file: 'tee-dyed/mauve.webp' },
      { slug: 'mushroom', name: "Mushroom", file: 'tee-dyed/mushroom.webp' },
      { slug: 'navy', name: "Navy", file: 'tee-dyed/navy.webp' },
      { slug: 'offwhite', name: "Offwhite", file: 'tee-dyed/offwhite.webp' },
      { slug: 'patchouli', name: "Patchouli", file: 'tee-dyed/patchouli.webp' },
      { slug: 'pink', name: "Pink", file: 'tee-dyed/pink.webp' },
      { slug: 'pool', name: "Pool", file: 'tee-dyed/pool.webp' },
      { slug: 'purple', name: "Purple", file: 'tee-dyed/purple.webp' },
      { slug: 'rosequartz', name: "Rosequartz", file: 'tee-dyed/rosequartz.webp' },
      { slug: 'sage', name: "Sage", file: 'tee-dyed/sage.webp' },
      { slug: 'tomato', name: "Tomato", file: 'tee-dyed/tomato.webp' },
      { slug: 'vintageblack', name: "Vintageblack", file: 'tee-dyed/vintageblack.webp' },
      { slug: 'white', name: "White", file: 'tee-dyed/white.webp' },
    ],
  },
  {
    id: 'tee-wash',
    label: 'Mineral wash tee',
    colors: [
      { slug: 'arctic', name: "Arctic", file: 'tee-wash/arctic.webp' },
      { slug: 'carbon', name: "Carbon", file: 'tee-wash/carbon.webp' },
      { slug: 'cocoa', name: "Cocoa", file: 'tee-wash/cocoa.webp' },
      { slug: 'ice-grey', name: "Ice Grey", file: 'tee-wash/ice-grey.webp' },
      { slug: 'indigo', name: "Igo", file: 'tee-wash/indigo.webp' },
      { slug: 'limestone', name: "Limestone", file: 'tee-wash/limestone.webp' },
      { slug: 'matcha', name: "Matcha", file: 'tee-wash/matcha.webp' },
    ],
  },
  {
    id: 'beanie',
    label: 'Beanie',
    colors: [
      { slug: 'golden-olive-heather', name: "Golden Olive Heather", file: 'beanie/golden-olive-heather.webp' },
      { slug: 'grey-heather', name: "Grey Heather", file: 'beanie/grey-heather.webp' },
      { slug: 'hot-orange', name: "Hot Orange", file: 'beanie/hot-orange.webp' },
      { slug: 'light-grey', name: "Light Grey", file: 'beanie/light-grey.webp' },
      { slug: 'oatmeal-heather', name: "Oatmeal Heather", file: 'beanie/oatmeal-heather.webp' },
      { slug: 'olive-heather', name: "Olive Heather", file: 'beanie/olive-heather.webp' },
      { slug: 'alabasterheather', name: "Alabasterheather", file: 'beanie/alabasterheather.webp' },
      { slug: 'black', name: "Black", file: 'beanie/black.webp' },
      { slug: 'bleached', name: "Bleached", file: 'beanie/bleached.webp' },
      { slug: 'brown', name: "Brown", file: 'beanie/brown.webp' },
      { slug: 'brownheather', name: "Brownheather", file: 'beanie/brownheather.webp' },
      { slug: 'bubblegum', name: "Bubblegum", file: 'beanie/bubblegum.webp' },
      { slug: 'burgundy', name: "Burgundy", file: 'beanie/burgundy.webp' },
      { slug: 'burgundyheather', name: "Burgundyheather", file: 'beanie/burgundyheather.webp' },
      { slug: 'chive', name: "Chive", file: 'beanie/chive.webp' },
      { slug: 'cobaltblue', name: "Cobaltblue", file: 'beanie/cobaltblue.webp' },
      { slug: 'darkbrownheather', name: "Darkbrownheather", file: 'beanie/darkbrownheather.webp' },
      { slug: 'darkgrey', name: "Darkgrey", file: 'beanie/darkgrey.webp' },
      { slug: 'darkheathergrey', name: "Darkheathergrey", file: 'beanie/darkheathergrey.webp' },
      { slug: 'darknavy', name: "Darknavy", file: 'beanie/darknavy.webp' },
      { slug: 'denimheather', name: "Denimheather", file: 'beanie/denimheather.webp' },
      { slug: 'forestgreen', name: "Forestgreen", file: 'beanie/forestgreen.webp' },
      { slug: 'huntergreen', name: "Huntergreen", file: 'beanie/huntergreen.webp' },
      { slug: 'kelly', name: "Kelly", file: 'beanie/kelly.webp' },
      { slug: 'lightblue', name: "Lightblue", file: 'beanie/lightblue.webp' },
      { slug: 'mulberry', name: "Mulberry", file: 'beanie/mulberry.webp' },
      { slug: 'natural', name: "Natural", file: 'beanie/natural.webp' },
      { slug: 'navy', name: "Navy", file: 'beanie/navy.webp' },
      { slug: 'neongreen', name: "Neongreen", file: 'beanie/neongreen.webp' },
      { slug: 'neonyellow', name: "Neonyellow", file: 'beanie/neonyellow.webp' },
      { slug: 'olive', name: "Olive", file: 'beanie/olive.webp' },
      { slug: 'red', name: "Red", file: 'beanie/red.webp' },
      { slug: 'rust', name: "Rust", file: 'beanie/rust.webp' },
      { slug: 'stone', name: "Stone", file: 'beanie/stone.webp' },
    ],
  },
  {
    id: 'shorts-thermal',
    label: 'Thermal shorts',
    colors: [
      { slug: 'black', name: "Black", file: 'shorts-thermal/black.webp' },
      { slug: 'blue', name: "Blue", file: 'shorts-thermal/blue.webp' },
      { slug: 'creme', name: "Creme", file: 'shorts-thermal/creme.webp' },
      { slug: 'white', name: "White", file: 'shorts-thermal/white.webp' },
    ],
  },
  {
    id: 'shorts-fleece',
    label: 'Fleece shorts',
    colors: [
      { slug: 'scour', name: "Scour", file: 'shorts-fleece/scour.webp' },
    ],
  },
  {
    id: 'tote',
    label: 'Tote bag',
    colors: [
      { slug: 'clear-blue', name: "Clear Blue", file: 'tote/clear-blue.webp' },
    ],
  },
  {
    id: 'gym-bag',
    label: 'Gym bag',
    colors: [
      { slug: 'light-pink', name: "Light Pink", file: 'gym-bag/light-pink.webp' },
      { slug: 'natural-canvas', name: "Natural Canvas", file: 'gym-bag/natural-canvas.webp' },
    ],
  },
]

export const garmentUrl = (file: string) => `/garments/${file}`

// A garment background is addressed as `garment:<product>/<colour>`
export function findGarment(ref: string): { product: GarmentProduct; color: GarmentColor } | null {
  const [pid, cslug] = ref.split('/')
  const product = GARMENTS.find((g) => g.id === pid)
  const color = product?.colors.find((c) => c.slug === cslug)
  return product && color ? { product, color } : null
}

