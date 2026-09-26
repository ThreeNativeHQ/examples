# FRICTION — grove

1. **No vegetation capability.** `engine_search_capabilities("foliage vegetation trees wind sway")`
   returns `verdict: none`. Tree generation and wind were copied from the engine repo's
   `examples/integrations/vegetation/src/`, which an installed game cannot see.
2. **`ez-tree-source` exports only its prebuilt bundle**, which eagerly loads textures. The pinned
   source entry is reached through a `vite.config.ts` alias plus `src/vegetation/ez-tree.d.ts`.
3. **The template's atmosphere sky is dark and faceted at midday** (0.2.6 `minimal`, identical on
   engine develop). At 13.5 h, with the sun 60° up, `atmosphere.radiance(view) * 8` renders a
   ~100/255 grey vault with visible arcs. The arcs stay at 96×48 dome segments and vanish when the
   dome ignores `radiance`, so they come from the radiance lookup, not the mesh. Replaced here with
   a game-owned gradient dome + `Fog`; the atmosphere still aims and colours the sun.
4. **Held state needs `allowTrivial`.** Values set once (`treeCount`, sun angles) are rejected as
   trivial unless every comparator carries a written reason.
5. **Leaf and bark winds must share one setting.** With a shared height envelope, different
   amplitudes slide each leaf off its twig; the first pass used 0.35/0.15 m.
