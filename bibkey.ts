// Affiche les blocs ```bibkey d'Obsidian (plugin Bibtex Entry View) comme des
// références bibliographiques mises en forme, à partir d'un fichier .bib.
// Testé avec Quartz 5.1.0.
//
// Installation (dans le dossier de Quartz) :
//   1. Copier ce fichier à côté de quartz.ts.
//   2. npm install @citation-js/core @citation-js/plugin-bibtex @citation-js/plugin-csl
//   3. Dans quartz.ts, ajouter :
//        import { BibkeyBlocks } from "./bibkey"
//      puis, juste après la ligne « const config = await loadQuartzConfig() » :
//        config.plugins.transformers.push(
//          BibkeyBlocks({ bibliographyFile: "./content/bibliographie.bib" }),
//        )
//      (Quartz 4 : ajouter BibkeyBlocks({...}) à la liste « transformers »
//      de quartz.config.ts.)
//   4. Facultatif, dans quartz/styles/custom.scss :
//        .bib-entry { border-left: 3px solid var(--secondary); padding: 0.4rem 0.8rem; background: var(--highlight); }
//
// Une clé absente du .bib s'affiche « Référence introuvable » sur la page
// et produit un avertissement pendant la génération du site.
import fs from "fs"
import { visit } from "unist-util-visit"
// @ts-ignore : citation-js ne fournit pas de types
import { Cite } from "@citation-js/core"
import "@citation-js/plugin-bibtex"
import "@citation-js/plugin-csl"

interface Options {
  /** Chemin du fichier .bib, relatif au dossier de Quartz */
  bibliographyFile: string
  /** Style : "apa", "vancouver" ou "harvard1" */
  style: string
  /** Langue des mentions (« et », « s. d. », etc.) */
  lang: string
}

const defaults: Options = {
  bibliographyFile: "./content/bibliographie.bib",
  style: "apa",
  lang: "fr-FR",
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const BibkeyBlocks = (userOpts?: Partial<Options>) => {
  const opts = { ...defaults, ...userOpts }
  let entries: Map<string, unknown> | undefined

  const load = () => {
    if (entries) return entries
    entries = new Map()
    if (!fs.existsSync(opts.bibliographyFile)) {
      console.warn(`[bibkey] fichier introuvable : ${opts.bibliographyFile}`)
      return entries
    }
    const cite = new Cite(fs.readFileSync(opts.bibliographyFile, "utf8"))
    for (const entry of cite.data) entries.set(entry.id, entry)
    return entries
  }

  const render = (key: string) => {
    const entry = load().get(key)
    if (!entry) {
      console.warn(`[bibkey] clé absente du fichier .bib : ${key}`)
      return `<p class="bib-entry bib-missing">Référence introuvable : <code>${escapeHtml(key)}</code></p>`
    }
    const html: string = new Cite(entry).format("bibliography", {
      format: "html",
      template: opts.style,
      lang: opts.lang,
    })
    const inner = html.match(/<div[^>]*class="csl-entry"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? html
    return `<p class="bib-entry">${inner.trim()}</p>`
  }

  return {
    name: "BibkeyBlocks",
    markdownPlugins() {
      return [
        () => (tree: any) => {
          visit(tree, "code", (node: any, index: number | undefined, parent: any) => {
            if (node.lang !== "bibkey" || !parent || index === undefined) return
            const keys = String(node.value).split(/\s+/).filter(Boolean)
            parent.children[index] = { type: "html", value: keys.map(render).join("\n") }
          })
        },
      ]
    },
  }
}
