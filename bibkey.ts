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

/** Découpe un fichier .bib en entrées (@book{...}, @article{...}, etc.). */
const splitEntries = (bib: string): string[] => {
  const starts: number[] = []
  const re = /^[ \t]*@[A-Za-z]+[ \t]*[{(]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(bib))) starts.push(m.index)
  return starts.map((s, i) => bib.slice(s, starts[i + 1] ?? bib.length).trim())
}

/**
 * Lecture tolérante d'une entrée mal formée (clé avec espace, virgule
 * manquante, valeur sans accolades, etc.). Renvoie la clé d'origine et une
 * entrée réécrite proprement, ou undefined si rien n'est récupérable.
 */
const repairEntry = (chunk: string): { key: string; text: string } | undefined => {
  const head = chunk.match(/^@([A-Za-z]+)[ \t]*[{(]/)
  if (!head) return undefined
  let rest = chunk.slice(head[0].length)
  let key = ""
  // La clé est ce qui précède la première virgule, sauf si la première ligne
  // est déjà un champ (clé absente) ou si la virgule manque.
  const firstLine = rest.split("\n")[0]
  if (/^\s*[A-Za-z][\w-]*\s*=/.test(firstLine) && !firstLine.includes(",")) {
    key = ""
  } else if (firstLine.includes(",")) {
    key = firstLine.slice(0, firstLine.indexOf(",")).trim()
    rest = rest.slice(firstLine.indexOf(",") + 1)
  } else {
    key = firstLine.trim()
    rest = rest.slice(firstLine.length)
  }
  if (!key) return undefined

  const fields: [string, string][] = []
  const fieldRe = /([A-Za-z][\w-]*)\s*=\s*/g
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(rest))) {
    let i = fieldRe.lastIndex
    let value = ""
    if (rest[i] === "{") {
      let depth = 0
      let j = i
      for (; j < rest.length; j++) {
        if (rest[j] === "{") depth++
        else if (rest[j] === "}" && --depth === 0) break
      }
      value = rest.slice(i + 1, j)
      i = j + 1
    } else if (rest[i] === '"') {
      const j = rest.indexOf('"', i + 1)
      value = rest.slice(i + 1, j === -1 ? rest.length : j)
      i = j === -1 ? rest.length : j + 1
    } else {
      const j = rest.slice(i).search(/[,\n}]/)
      const end = j === -1 ? rest.length : i + j
      value = rest.slice(i, end)
      i = end
    }
    fields.push([m[1].toLowerCase(), value.trim()])
    fieldRe.lastIndex = i
  }
  if (fields.length === 0) return undefined
  const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n")
  return { key, text: `@${head[1]}{bibkeytmp,\n${body}\n}` }
}

/** Retire les espaces superflus des valeurs (« { Titre } » dans les exports Cairn). */
const trimStrings = (value: any): any => {
  if (typeof value === "string") return value.trim()
  if (Array.isArray(value)) return value.map(trimStrings)
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = trimStrings(value[k])
  }
  return value
}

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
    const bib = fs.readFileSync(opts.bibliographyFile, "utf8").replace(/^﻿/, "")
    for (const rawChunk of splitEntries(bib)) {
      // « = { valeur }, » devient « = {valeur}, » (exports Cairn)
      const chunk = rawChunk
        .replace(/=[ \t]*\{[ \t]+/g, "= {")
        .replace(/[ \t]+\}([ \t]*,?[ \t]*)$/gm, "}$1")
      if (/^@(comment|preamble|string)\b/i.test(chunk)) continue
      try {
        for (const entry of new Cite(chunk).data) entries.set(String(entry.id), trimStrings(entry))
        continue
      } catch {
        // entrée mal formée : on tente la lecture tolérante ci-dessous
      }
      const repaired = repairEntry(chunk)
      try {
        if (!repaired) throw new Error("illisible")
        const entry = trimStrings(new Cite(repaired.text).data[0])
        entry.id = repaired.key
        entry["citation-key"] = repaired.key
        entries.set(repaired.key, entry)
        console.warn(`[bibkey] entrée mal formée, lue en mode tolérant : ${repaired.key}`)
      } catch {
        console.warn(`[bibkey] entrée ignorée (illisible) : ${chunk.split("\n")[0]}`)
      }
    }
    return entries
  }

  const render = (rawKey: string) => {
    const key = rawKey.trim()
    try {
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
      const linked = inner.trim().replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
      return `<p class="bib-entry">${linked}</p>`
    } catch (err) {
      console.warn(`[bibkey] référence non mise en forme : ${key} (${err})`)
      return `<p class="bib-entry bib-missing">Référence non mise en forme : <code>${escapeHtml(key)}</code></p>`
    }
  }

  return {
    name: "BibkeyBlocks",
    markdownPlugins() {
      return [
        () => (tree: any) => {
          visit(tree, "code", (node: any, index: number | undefined, parent: any) => {
            if (node.lang !== "bibkey" || !parent || index === undefined) return
            // Une clé par ligne (une clé mal formée peut contenir un espace)
            const keys = String(node.value).split(/\r?\n/).map((k) => k.trim()).filter(Boolean)
            parent.children[index] = { type: "html", value: keys.map(render).join("\n") }
          })
        },
      ]
    },
  }
}
