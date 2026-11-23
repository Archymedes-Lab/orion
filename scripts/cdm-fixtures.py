"""Regenerate tests/fixtures/cdm-cases.json from the Python reference (../creative-decision, cdm v0.2.0).

    cd ../creative-decision && uv run python ../orion/scripts/cdm-fixtures.py ../orion/tests/fixtures/cdm-cases.json
"""
import json, sys, numpy as np
from cdm import Problem, Option, Dimension, Constraint, decide
from cdm.model import Judgment
rng = np.random.default_rng(20261020)
def case(D, n, baseline, values):
    dims=[Dimension(f"d{k}","q",tuple("abcde"),weight=float(rng.uniform(0.05,1)),values=(tuple(sorted(rng.uniform(-1,2,5))) if values else None)) for k in range(D)]
    cons=[Constraint("h1","x",hard=True),Constraint("h2","y",hard=True),Constraint("s1","z",hard=False)]
    opts=[Option(f"o{i}","t",baseline=(i==0 and baseline)) for i in range(n)]
    q=lambda: float(rng.choice([0.0,0.02,0.1,0.15,0.16,0.3,0.5,0.69,0.7,0.8,rng.uniform()]))
    def dist():
        p=rng.dirichlet(np.full(5, rng.choice([0.3,1.0,5.0])))
        return p
    js=[Judgment(o,{d.id:dist() for d in dims},{c.id:q() for c in cons},dist(),{"a":float(rng.uniform()),"b":float(rng.uniform()),"c":float(rng.uniform())}) for o in opts]
    d=decide(Problem("g",{},opts,dims,cons,niches={"a":"","b":"","c":""}),js)
    return {"problem":{"dimensions":[{"id":x.id,"weight":x.weight,"levels":5,**({"values":list(x.values)} if x.values else {})} for x in dims],"limits":[{"id":c.id,"hard":c.hard} for c in cons]},
      "judgments":[{"optionId":j.option.id,"baseline":j.option.baseline,"dims":{k:v.tolist() for k,v in j.dims.items()},"violations":j.violations,"novelty":j.novelty.tolist(),"niche":j.niche} for j in js],
      "expect":{"commit":d.commit,"innovation":d.innovation,"portfolio":d.portfolio,"evpi":d.evpi,"escalate":d.escalate,"stats":{s.id:{"mean":s.mean,"cvar":s.cvar,"pBest":s.p_best,"ei":s.ei,"status":s.status,"reliable":s.reliable} for s in d.stats}}}
exact=[case(int(rng.integers(1,5)),int(rng.integers(1,7)),bool(rng.uniform()<0.6),bool(rng.uniform()<0.3)) for _ in range(40)]
large=[case(int(rng.integers(6,9)),int(rng.integers(3,7)),True,False) for _ in range(6)]
json.dump({"exact":exact,"large":large},open(sys.argv[1],"w"))
print(len(exact),len(large))
