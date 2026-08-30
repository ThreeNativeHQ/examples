# Blast Curtain

Press Space. The curtain wins only when it visibly deforms by at least 0.35 metres while the
existing physics barrier keeps every sampled vertex on its near side; any fresh post-blast sample
that misses either condition loses.

| Mined feature | PRD | Game rule | Observable proof |
| --- | --- | --- | --- |
| `SoftBody3D` | PRD-243 | The planar curtain must deform under the blast | `state.deformation` |
| `softBodyCollision` | PRD-243 | The curtain must not cross the existing box barrier | `state.barrierHeld` |
| Async readback | PRD-243 | Only a sample issued 30 solver ticks after input adjudicates | `state.outcome` |

The packed capability manifest named both APIs and their constraints before implementation. The
sandbox contains no engine source and installs `@threenative/core` and `@threenative/physics` from
detached tarballs under `/home/joao/projects/threenative/sandbox/.packages`.
