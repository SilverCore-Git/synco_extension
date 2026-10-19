// Ce que le build produit : bundles (chemin source) et fichiers copiés tels quels (nom publié → chemin source).
export const ENTRIES = {
  background: 'src/background/index.ts',
  content: 'src/bridge/content.ts',
  prompt: 'src/ui/prompt/index.ts',
  options: 'src/ui/options/index.ts',
};

export const STATIC = {
  'prompt.html': 'src/ui/prompt/prompt.html',
  'options.html': 'src/ui/options/options.html',
  'ui.css': 'src/ui/ui.css',
  'icons/icon-16.png': 'assets/icons/icon-16.png',
  'icons/icon-32.png': 'assets/icons/icon-32.png',
  'icons/icon-48.png': 'assets/icons/icon-48.png',
  'icons/icon-128.png': 'assets/icons/icon-128.png',
};
