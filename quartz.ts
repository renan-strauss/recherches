import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { BibkeyBlocks } from "./bibkey"

const config = await loadQuartzConfig()
config.plugins.transformers.push(BibkeyBlocks({ bibliographyFile: "./content/bibliographie.bib" }))

export default config
export const layout = await loadQuartzLayout()
