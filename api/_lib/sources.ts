import type { SourceInfo } from '../../shared/types.js'

// Display metadata for sources. Counts come from the index at runtime.
export const SOURCE_META: Record<string, Omit<SourceInfo, 'count' | 'contentTypes'>> = {
  met: { key: 'met', name: 'The Met', homepage: 'https://www.metmuseum.org/art/collection', license: 'CC0 (Open Access)' },
  aic: { key: 'aic', name: 'Art Institute of Chicago', homepage: 'https://www.artic.edu/collection', license: 'CC0 (public domain works)' },
  cma: { key: 'cma', name: 'Cleveland Museum of Art', homepage: 'https://www.clevelandart.org/art/collection/search', license: 'CC0 (Open Access)' },
  nga: { key: 'nga', name: 'National Gallery of Art', homepage: 'https://www.nga.gov/collection', license: 'CC0 (Open Access)' },
  rijks: { key: 'rijks', name: 'Rijksmuseum', homepage: 'https://www.rijksmuseum.nl/en/collection', license: 'Public domain works' },
  si: { key: 'si', name: 'Smithsonian', homepage: 'https://www.si.edu/openaccess', license: 'CC0 (Open Access)' },
  nasa3d: { key: 'nasa3d', name: 'NASA 3D Resources', homepage: 'https://science.nasa.gov/3d-resources/', license: 'Public domain (NASA)' },
  nih3d: { key: 'nih3d', name: 'NIH 3D', homepage: 'https://3d.nih.gov/', license: 'Per model (PD / CC BY)' },
  wellcome: { key: 'wellcome', name: 'Wellcome Collection', homepage: 'https://wellcomecollection.org/collections', license: 'PD / CC BY' },
}

export function sourceName(key: string): string {
  return SOURCE_META[key]?.name ?? key
}
