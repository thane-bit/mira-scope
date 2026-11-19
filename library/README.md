# Library

Graphs saved by the MIRA Scope site, one JSON file per paper and ontology:
`<slug>-<hash8>.<discourse|outcomes>.json`. `hash8` is the first 8 hex characters of the SHA-256 of the paper's text, which is how the site recognises a paper it has already extracted and skips the model call.

Only the graph and metadata are stored, never the paper's full text. This folder is public.
