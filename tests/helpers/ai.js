import { Readable } from "node:stream";

export const extraction = {
  title: "Cook or order food",
  category: ["Food"],
  options: [
    { label: "Cook", description: "Prepare food at home", rationale: "Cheaper and healthier", risks: ["Takes time"], reversibilityLevel: "easy", generated: false },
    { label: "Order", description: "Get delivery", rationale: "Convenient", risks: ["More expensive"], reversibilityLevel: "easy", generated: false },
  ],
  factors: [
    { label: "Cost", importance: 0.6, reason: "Budget matters.", provenance: "MODEL_INFERRED", source: "Category: Food" },
    { label: "Time", importance: 0.4, reason: "Preparation takes time.", provenance: "MODEL_INFERRED", source: "Category: Food" },
  ],
  missingInformation: [{ question: "Which matters most: Cost or Time?", expectedInformationGain: 0.8 }],
  stakes: "normal",
  safety: "normal",
  provenance: {
    options: { opt_1: "USER_STATED", opt_2: "USER_STATED" },
    factors: { fac_1: "MODEL_INFERRED", fac_2: "MODEL_INFERRED" },
    stakes: "MODEL_INFERRED",
    category: "MODEL_INFERRED",
  },
  obligations: [],
  generatedOptions: [],
};
export const scoreInput = {
  context: "Should I cook or order food? I have ingredients and thirty minutes.",
  stakes: "normal",
  options: [{ id: "a", label: "Cook" }, { id: "b", label: "Order" }],
  factors: [{ id: "cost", label: "Cost" }, { id: "time", label: "Time" }],
};
export const scoresFor = (input) => input.options.flatMap((o, i) => input.factors.map((f) => ({
  optionId: o.id, factorId: f.id, value: f.label === "Cost" ? (i === 0 ? 6 : -4) : (i === 0 ? -2 : 6), probabilityConfidence: 0.6,
})));
export const openaiResponse = (data, extra = {}) => Response.json({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }],
  usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 100 } },
  ...extra,
});
export const anthropicResponse = (data, extra = {}) => Response.json({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(data) }],
  usage: { input_tokens: 1000, output_tokens: 200 },
  ...extra,
});
export const invoke = (handler, path, value, headers = {}) => new Promise((resolve, reject) => {
  const req = Readable.from([typeof value === "string" ? value : JSON.stringify(value)]);
  req.url = path; req.method = "POST"; req.headers = headers;
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null, headers: this.headers }); },
  };
  handler(req, response).catch(reject);
});
