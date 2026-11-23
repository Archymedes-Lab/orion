// Every Korean string, merged. Each area keeps its own file so the dictionary stays reviewable.
import { account } from "./account.ts";
import { aftermath } from "./aftermath.ts";
import { app } from "./app.ts";
import { decide } from "./decide.ts";
import { engine } from "./engine.ts";
import { prioritize } from "./prioritize.ts";
import { server } from "./server.ts";
import { web } from "./web.ts";

export const ko: Record<string, string> = { ...engine, ...aftermath, ...decide, ...account, ...app, ...server, ...web, ...prioritize };
