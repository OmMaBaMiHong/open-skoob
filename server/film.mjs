import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError, complete } from './models.mjs';
const value = z.union([z.string(), z.number(), z.boolean()]);
const condition = z.object({ var: z.string(), op: z.enum(['>=','<=','>','<','==','!=']), value });
const effect = z.object({ var: z.string(), op: z.enum(['set','add','sub']), value });
const node = z.object({ id: z.string().min(1), title: z.string(), type: z.enum(['start','normal','branch','merge','ending','explore']), sceneDesc: z.string(), dialogue: z.array(z.object({ speaker: z.string(), text: z.string(), emotion: z.string() })), choices: z.array(z.object({ id: z.string(), text: z.string(), targetNodeId: z.string(), condition: condition.optional(), effects: z.array(effect).optional(), weight: z.enum(['light','heavy','critical']).optional() })), imageSlot: z.object({ prompt: z.string(), assetRef: z.string().optional() }).optional(), act: z.string().optional() });
const schema = z.object({ schemaVersion: z.literal(1), projectId: z.string(), title: z.string(), characters: z.array(z.object({ id: z.string(), name: z.string(), role: z.string().optional(), motivation: z.string().optional() })).optional(), variables: z.array(z.object({ name: z.string(), type: z.enum(['flag','counter','relationship','item']), default: value, desc: z.string() })), nodes: z.array(node).min(1).max(300), endings: z.array(z.object({ id: z.string(), nodeId: z.string(), title: z.string(), type: z.enum(['good','bad','neutral','secret']), description: z.string() })) });
const valid = (c, vars) => !c || ({ '==': () => vars[c.var] === c.value, '!=': () => vars[c.var] !== c.value, '>=': () => Number(vars[c.var]) >= Number(c.value), '<=': () => Number(vars[c.var]) <= Number(c.value), '>': () => Number(vars[c.var]) > Number(c.value), '<': () => Number(vars[c.var]) < Number(c.value) })[c.op]();
export function analyzeGraph(graph) {
  const issues = []; const arcs = []; const byEnding = {}; const lengthHistogram = {}; const visited = new Set(); let truncated = false; let examined = 0;
  const nodes = new Map(graph.nodes.map(n => [n.id,n]));
  if (nodes.size !== graph.nodes.length) issues.push({ code: 'DUPLICATE_ID', level: 'error', message: '节点 ID 重复', nodeIds: [] });
  if (graph.nodes.filter(n => n.type === 'start').length !== 1) issues.push({ code: 'START_COUNT', level: 'error', message: '需要且只能有一个开场节点', nodeIds: [] });
  for (const n of graph.nodes) for (const c of n.choices) if (!nodes.has(c.targetNodeId)) issues.push({ code: 'BROKEN_LINK', level: 'error', message: '选项指向不存在的节点', nodeIds: [n.id] });
  const walk = (id, path, vars) => {
    if (++examined > 10000 || path.length > 100 || arcs.length >= 1000) { truncated = true; return; }
    const n = nodes.get(id); if (!n) return; visited.add(id); const nextPath = [...path,n.id]; const ending = graph.endings.find(e => e.nodeId === id);
    const choices = n.choices.filter(c => valid(c.condition, vars));
    if (ending || !choices.length) { const end = ending?.id || '(dead-end)'; byEnding[end] = (byEnding[end] || 0) + 1; lengthHistogram[nextPath.length] = (lengthHistogram[nextPath.length] || 0) + 1; arcs.push({ endingId: ending?.id || null, points: nextPath.map(nodeId => ({ nodeId, score: 0 })) }); if (!ending) issues.push({ code: 'DEAD_END', level: 'error', message: '路径无法到达结局', nodeIds: [id] }); return; }
    if (path.includes(id)) { truncated = true; issues.push({ code: 'CYCLE', level: 'warning', message: '循环路径未穷举', nodeIds: [id] }); return; }
    for (const c of choices) { const v = { ...vars }; for (const e of c.effects || []) v[e.var] = e.op === 'set' ? e.value : Number(v[e.var] ?? 0) + (e.op === 'add' ? 1 : -1) * Number(e.value); walk(c.targetNodeId,nextPath,v); }
  };
  walk(graph.nodes.find(n => n.type === 'start')?.id, [], Object.fromEntries(graph.variables.map(v => [v.name,v.default])));
  for (const n of graph.nodes) if (!visited.has(n.id)) issues.push({ code: 'UNREACHABLE', level: 'warning', message: '节点在当前条件下不可达', nodeIds: [n.id] });
  return { report: { ok: !issues.some(i => i.level === 'error'), issues }, arcs: { arcs, truncated }, distribution: { total: arcs.length, truncated, byEnding, lengthHistogram } };
}
export function mountFilms(app, store) {
  const get = id => { const f = store.get('films', id); if (!f) throw new ApiError(404, 'FILM_NOT_FOUND', '影游不存在'); return f; };
  const summary = f => { const a = analyzeGraph(f.graph); return { id: f.graph.projectId, title: f.graph.title, nodes: f.graph.nodes.length, endings: f.graph.endings.length, paths: a.distribution.total, pathsTruncated: a.distribution.truncated, updatedAt: f.updatedAt }; };
  const parse = raw => { const r = schema.safeParse(raw); if (!r.success) throw new ApiError(422, 'GRAPH_INVALID', '影游结构不完整，请检查节点、对话、选择和结局'); return r.data; };
  app.get('/api/v1/films', c => c.json({ films: store.list('films').map(summary) }));
  app.post('/api/v1/films', async c => {
    const b = await c.req.json(); if (typeof b.premise !== 'string' || !b.premise.trim() || b.premise.length > 20000) throw new ApiError(400, 'PREMISE_REQUIRED', '请填写影游前提'); const id = randomUUID();
    const raw = await complete(store, {}, [{ role: 'system', content: '根据用户前提生成可玩的分支小说，只输出 JSON。结构：{schemaVersion:1,projectId:"",title,variables:[],nodes:[{id,title,type:"start|normal|branch|ending",sceneDesc,dialogue:[{speaker,text,emotion}],choices:[{id,text,targetNodeId}]}],endings:[{id,nodeId,title,type:"good|bad|neutral|secret",description}]}。节点必须使用唯一 id，所有选择指向现存节点；一个 start，至少两处分岔、至少两个不同结局；无循环，每条路都到结局。场景和对话要具体，结局有明确代价，不需要图片。' }, { role: 'user', content: b.premise }], { json: true, signal: c.req.raw.signal });
    const graph = parse({ ...raw, projectId: id, ...(b.title ? { title: b.title } : {}) }); const a = analyzeGraph(graph);
    if (!a.report.ok || a.distribution.truncated || graph.endings.length < 2 || graph.nodes.filter(n => n.choices.length >= 2).length < 2) throw new ApiError(502, 'GRAPH_GENERATION_INVALID', '模型生成的分支未通过可达性检查，请重试或更换模型');
    const film = { graph, rev: 1, updatedAt: Date.now() }; store.set('films', id, film); return c.json({ film: summary(film) });
  });
  app.get('/api/v1/projects/:id/story-graph', c => c.json(get(c.req.param('id')).graph));
  app.get('/api/v1/projects/:id/story-graph/analysis', c => c.json(analyzeGraph(get(c.req.param('id')).graph)));
  app.post('/api/v1/projects/:id/story-graph/delta', async c => { const f = get(c.req.param('id')); const b = await c.req.json(); const delta = b.delta?.nodes; if (!Array.isArray(delta?.upsert) || !Array.isArray(delta?.remove)) throw new ApiError(400, 'DELTA_INVALID', '节点修改格式无效'); const nodes = new Map(f.graph.nodes.map(n => [n.id,n])); for (const id of delta.remove) nodes.delete(id); for (const item of delta.upsert) nodes.set(item.id,item); f.graph = parse({ ...f.graph, nodes: [...nodes.values()] }); f.rev++; f.updatedAt = Date.now(); store.set('films', c.req.param('id'), f); return c.json({ rev: f.rev, graph: f.graph }); });
  app.post('/api/v1/projects/:id/nodes/:node/image', c => { get(c.req.param('id')); throw new ApiError(409, 'CLOUD_IMAGE_REQUIRED', '节点配图请使用已开通的官方天工服务；本地文字影游可直接游玩。'); });
  app.get('/api/v1/projects/:id/export/:format', c => {
    const graph = get(c.req.param('id')).graph; const format = c.req.param('format'); c.header('Content-Disposition', `attachment; filename="${graph.projectId}.${format}"`);
    if (format === 'json') return c.json(graph);
    if (format === 'ink') { if (graph.variables.length || graph.nodes.some(n => n.choices.some(x => x.condition || x.effects?.length))) throw new ApiError(422,'INK_VARIABLES','含变量的影游请导出 JSON 或 HTML，以保留分支条件'); const key = new Map(graph.nodes.map((n,i) => [n.id,`scene_${i}`])); const clean = text => text.replace(/[\r\n]/g,' ').replace(/[\[\]{}*+=<>#~]/g,''); return c.text(`-> ${key.get(graph.nodes.find(n=>n.type==='start')?.id)}\n` + graph.nodes.map(n=>`\n=== ${key.get(n.id)} ===\n${clean(n.sceneDesc)}\n${n.dialogue.map(d=>clean(d.speaker+': '+d.text)).join('\n')}\n${n.choices.map(x=>`* [${clean(x.text)}] -> ${key.get(x.targetNodeId)}`).join('\n')}${!n.choices.length?'\n-> END':''}`).join('\n')); }
    if (format !== 'html') throw new ApiError(400, 'FORMAT_INVALID', '支持 JSON、Ink 和 HTML');
    const data = JSON.stringify(graph).replace(/</g,'\\u003c');
    return c.html(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open-Skoob 影游</title><style>body{max-width:720px;margin:60px auto;padding:24px;font:18px/1.8 system-ui}button{display:block;padding:12px;margin:12px 0;cursor:pointer}p{white-space:pre-wrap}</style><main><h1></h1><p></p><section></section></main><script>const g=${data};let vars={};const valid=${valid.toString()};function start(){vars=Object.fromEntries(g.variables.map(v=>[v.name,v.default]));show(g.nodes.find(n=>n.type==='start').id)}function show(id){const n=g.nodes.find(n=>n.id===id);document.querySelector('h1').textContent=n.title;document.querySelector('p').textContent=n.sceneDesc+'\\n'+n.dialogue.map(d=>d.speaker+'：'+d.text).join('\\n');const s=document.querySelector('section');s.replaceChildren();for(const c of n.choices){const b=document.createElement('button');b.textContent=c.text;b.disabled=!valid(c.condition,vars);b.onclick=()=>{for(const e of c.effects||[])vars[e.var]=e.op==='set'?e.value:Number(vars[e.var]??0)+(e.op==='add'?1:-1)*Number(e.value);show(c.targetNodeId)};s.append(b)}const b=document.createElement('button');b.textContent='重新开始';b.onclick=start;s.append(b)}start();</script></html>`);
  });
}
