// Garment blanks from the Bayside design lab, cut out of their studio backdrop, usable as a
// background so a piece can be seen on the thing it would actually be printed on.
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
    label: 'Heavyweight hoodie',
    colors: [
      { slug: 'laa-14oz-offblack', name: "Offblack", file: 'hoodie-heavy/laa-14oz-offblack.webp' },
      { slug: 'laa-14oz-cream', name: "Cream", file: 'hoodie-heavy/laa-14oz-cream.webp' },
      { slug: 'laa-14oz-navy', name: "Navy", file: 'hoodie-heavy/laa-14oz-navy.webp' },
      { slug: 'laa-14oz-army', name: "Army", file: 'hoodie-heavy/laa-14oz-army.webp' },
      { slug: 'laa-14oz-chocolate', name: "Chocolate", file: 'hoodie-heavy/laa-14oz-chocolate.webp' },
      { slug: 'laa-14oz-brightorange', name: "Brightorange", file: 'hoodie-heavy/laa-14oz-brightorange.webp' },
      { slug: 'laa-14oz-sage', name: "Sage", file: 'hoodie-heavy/laa-14oz-sage.webp' },
      { slug: 'laa-14oz-rosequartz', name: "Rosequartz", file: 'hoodie-heavy/laa-14oz-rosequartz.webp' },
      { slug: 'laa-14oz-cobaltblue', name: "Cobaltblue", file: 'hoodie-heavy/laa-14oz-cobaltblue.webp' },
      { slug: 'laa-14oz-darkred', name: "Darkred", file: 'hoodie-heavy/laa-14oz-darkred.webp' },
      { slug: 'laa-14oz-mushroom', name: "Mushroom", file: 'hoodie-heavy/laa-14oz-mushroom.webp' },
      { slug: 'laa-14oz-vintageblack', name: "Vintageblack", file: 'hoodie-heavy/laa-14oz-vintageblack.webp' },
    ],
  },
  {
    id: 'hoodie-mid',
    label: 'Midweight hoodie',
    colors: [
      { slug: 'ind-8p5-black', name: "Black", file: 'hoodie-mid/ind-8p5-black.webp' },
      { slug: 'ind-8p5-ivory', name: "Ivory", file: 'hoodie-mid/ind-8p5-ivory.webp' },
      { slug: 'ind-8p5-navy', name: "Navy", file: 'hoodie-mid/ind-8p5-navy.webp' },
      { slug: 'ind-8p5-olive', name: "Olive", file: 'hoodie-mid/ind-8p5-olive.webp' },
      { slug: 'ind-8p5-cherry', name: "Cherry", file: 'hoodie-mid/ind-8p5-cherry.webp' },
      { slug: 'ind-8p5-azure', name: "Azure", file: 'hoodie-mid/ind-8p5-azure.webp' },
      { slug: 'ind-8p5-sand', name: "Sand", file: 'hoodie-mid/ind-8p5-sand.webp' },
      { slug: 'ind-8p5-seafoam', name: "Seafoam", file: 'hoodie-mid/ind-8p5-seafoam.webp' },
      { slug: 'ind-8p5-greyheather', name: "Greyheather", file: 'hoodie-mid/ind-8p5-greyheather.webp' },
      { slug: 'ind-8p5-violet', name: "Violet", file: 'hoodie-mid/ind-8p5-violet.webp' },
    ],
  },
  {
    id: 'hoodie-premium',
    label: 'Premium hoodie',
    colors: [
      { slug: 'ind420hoodie-black', name: "Black", file: 'hoodie-premium/ind420hoodie-black.webp' },
      { slug: 'ind420hoodie-ivory', name: "Ivory", file: 'hoodie-premium/ind420hoodie-ivory.webp' },
      { slug: 'ind420hoodie-classic-navy', name: "Classic Navy", file: 'hoodie-premium/ind420hoodie-classic-navy.webp' },
      { slug: 'ind420hoodie-olive', name: "Olive", file: 'hoodie-premium/ind420hoodie-olive.webp' },
      { slug: 'ind420hoodie-brown', name: "Brown", file: 'hoodie-premium/ind420hoodie-brown.webp' },
      { slug: 'ind420hoodie-grey-heather', name: "Grey Heather", file: 'hoodie-premium/ind420hoodie-grey-heather.webp' },
      { slug: 'ind420hoodie-pigmentblack', name: "Pigmentblack", file: 'hoodie-premium/ind420hoodie-pigmentblack.webp' },
    ],
  },
  {
    id: 'crewneck',
    label: 'Crewneck',
    colors: [
      { slug: 'blackfront', name: "Black", file: 'crewneck/blackfront.webp' },
      { slug: 'offwhitefront', name: "Offwhite", file: 'crewneck/offwhitefront.webp' },
      { slug: 'navyfront', name: "Navy", file: 'crewneck/navyfront.webp' },
      { slug: 'armyfront', name: "Army", file: 'crewneck/armyfront.webp' },
      { slug: 'chocolatefront', name: "Chocolate", file: 'crewneck/chocolatefront.webp' },
      { slug: 'tomatofront', name: "Tomato", file: 'crewneck/tomatofront.webp' },
      { slug: 'sagefront', name: "Sage", file: 'crewneck/sagefront.webp' },
      { slug: 'cobaltbluefront', name: "Cobaltblue", file: 'crewneck/cobaltbluefront.webp' },
      { slug: 'lightgreyfront', name: "Lightgrey", file: 'crewneck/lightgreyfront.webp' },
      { slug: 'cremefront', name: "Creme", file: 'crewneck/cremefront.webp' },
      { slug: 'purplefront', name: "Purple", file: 'crewneck/purplefront.webp' },
      { slug: 'goldfront', name: "Gold", file: 'crewneck/goldfront.webp' },
    ],
  },
  {
    id: 'crewneck-wash',
    label: 'Mineral wash crewneck',
    colors: [
      { slug: 'carbon-front', name: "Carbon", file: 'crewneck-wash/carbon-front.webp' },
      { slug: 'arctic-front', name: "Arctic", file: 'crewneck-wash/arctic-front.webp' },
      { slug: 'indigo-front', name: "Indigo", file: 'crewneck-wash/indigo-front.webp' },
      { slug: 'cocoa-front', name: "Cocoa", file: 'crewneck-wash/cocoa-front.webp' },
      { slug: 'matcha-front', name: "Matcha", file: 'crewneck-wash/matcha-front.webp' },
      { slug: 'limestone-front', name: "Limestone", file: 'crewneck-wash/limestone-front.webp' },
    ],
  },
  {
    id: 'zip-hoodie',
    label: 'Zip hoodie',
    colors: [
      { slug: 'ind420zip-black', name: "Black", file: 'zip-hoodie/ind420zip-black.webp' },
      { slug: 'ind420zip-heather-grey', name: "Heather Grey", file: 'zip-hoodie/ind420zip-heather-grey.webp' },
      { slug: 'ind420zip-pigment-black', name: "Pigment Black", file: 'zip-hoodie/ind420zip-pigment-black.webp' },
    ],
  },
  {
    id: 'beanie',
    label: 'Beanie',
    colors: [
      { slug: 'black', name: "Black", file: 'beanie/black.webp' },
      { slug: 'natural', name: "Natural", file: 'beanie/natural.webp' },
      { slug: 'navy', name: "Navy", file: 'beanie/navy.webp' },
      { slug: 'olive', name: "Olive", file: 'beanie/olive.webp' },
      { slug: 'burgundy', name: "Burgundy", file: 'beanie/burgundy.webp' },
      { slug: 'rust', name: "Rust", file: 'beanie/rust.webp' },
      { slug: 'forestgreen', name: "Forestgreen", file: 'beanie/forestgreen.webp' },
      { slug: 'grey-heather', name: "Grey Heather", file: 'beanie/grey-heather.webp' },
      { slug: 'cobaltblue', name: "Cobaltblue", file: 'beanie/cobaltblue.webp' },
      { slug: 'neonyellow', name: "Neonyellow", file: 'beanie/neonyellow.webp' },
    ],
  },
  {
    id: 'shorts',
    label: 'Thermal shorts',
    colors: [
      { slug: 'blackfront', name: "Black", file: 'shorts/blackfront.webp' },
      { slug: 'cremefront', name: "Creme", file: 'shorts/cremefront.webp' },
      { slug: 'bluefront', name: "Blue", file: 'shorts/bluefront.webp' },
      { slug: 'whitefront', name: "White", file: 'shorts/whitefront.webp' },
    ],
  },
  {
    id: 'tote',
    label: 'Tote bag',
    colors: [
      { slug: 'clearblue', name: "Clearblue", file: 'tote/clearblue.webp' },
    ],
  },
  {
    id: 'gym-bag',
    label: 'Gym bag',
    colors: [
      { slug: 'naturalcanvas', name: "Naturalcanvas", file: 'gym-bag/naturalcanvas.webp' },
      { slug: 'lightpink', name: "Lightpink", file: 'gym-bag/lightpink.webp' },
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

