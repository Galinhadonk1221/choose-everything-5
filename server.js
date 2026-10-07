const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 25000 });
app.use(express.static(path.join(__dirname, "public")));

const categories = JSON.parse(fs.readFileSync(path.join(__dirname,"cards.json"),"utf8"));
const animeImageManifest = JSON.parse(fs.readFileSync(path.join(__dirname,"anime-images.json"),"utf8"));
const allCards = categories.flatMap(c=>c.cards);
const cardMap = new Map(allCards.map(c=>[c.id,c]));
const imageCache = new Map();
const imageBinaryCache = new Map();
const rooms = new Map();


// Private guidance used only by the final battle judge. These notes are never sent to the browser.
// For generic character cards, the judge uses the strongest canon version reached in the primary source.
// If the card explicitly names a form, that exact form/version takes priority.
const BATTLE_GUIDANCE = {
  "Rimuru Tempest": "Treat as peak canonical light-novel Rimuru. Extremely high-tier: Ciel-level analysis/support, Azathoth, soul/energy absorption, Imaginary Space, space-time abilities, very high regeneration/defenses and broad resistance/hax. Do not treat Rimuru like only the early-anime version.",
  "Anos Voldigoad": "Treat as peak canonical main-source Anos. Extremely high-tier with source-based existence, resurrection, magic negation/destruction, Venuzdnor-related effects and resistance to many conventional kill conditions.",
  "Zeno": "Dragon Ball Super Zeno. Universe/timeline-scale erasure is his defining win condition, but do not automatically equate erasure with combat speed or resistance to every cross-verse hax.",
  "Grand Priest": "Dragon Ball Super Grand Priest; among the setting's highest known combat authorities. Scale well above ordinary Gods of Destruction and most mortals, while avoiding invented feats.",
  "Whis": "Dragon Ball Super Whis; angel-tier speed, reactions, martial skill and temporal utility. Scale above Beerus in ordinary combat portrayal.",
  "Beerus": "Dragon Ball Super Beerus; God of Destruction with Hakai and very high speed/power. Consider Hakai interactions with immortality/resistance instead of assuming it always works.",
  "Goku Ultra Instinct": "Use the Ultra Instinct form named on the card and current canon-relevant feats for that form. Prioritize combat speed, reactions, adaptation and ki scale; do not grant unrelated noncanon abilities.",
  "Black Frieza": "Use Black Frieza from Dragon Ball Super manga. Treat as above contemporary Goku/Vegeta forms by his demonstrated portrayal, without inventing unknown techniques.",
  "Saitama": "Use current manga-canon Saitama. Account for extreme physical growth, speed and durability shown against Cosmic Garou; do not use pure gag/NLF reasoning as an automatic win against abstract hax.",
  "Cosmic Garou": "Use Cosmic Fear Mode Garou with copying, radiation/energy effects, portals and high-end Saitama-fight feats, but respect limits shown in canon.",
  "Gojo Satoru": "Infinity, Six Eyes, Unlimited Void and Hollow Purple are central. Do not award a win merely for higher raw strength if the opponent lacks a demonstrated way around Infinity/domain effects.",
  "Ryomen Sukuna": "Use peak manga-canon Sukuna. Consider Malevolent Shrine, World-Cutting Slash and domain/combat skill; do not scale him to unrelated cosmic tiers.",
  "Naruto Six Paths": "Use Six Paths-era Naruto as named. Consider clones, sensory abilities, Truth-Seeking interactions where applicable, speed and large-scale chakra attacks.",
  "Kaguya Otsutsuki": "Consider dimensional shifting, regeneration/immortality traits, expansive Truth-Seeking Ball and kill/seal requirements rather than raw damage only.",
  "Monkey D. Luffy Gear 5": "Use Gear 5 as named. Consider advanced Haki, awakening/body freedom, stamina limits and current manga feats; avoid literal omnipotent 'toon force' assumptions.",
  "Ichigo Kurosaki TYBW": "Use endgame TYBW Ichigo. High spiritual pressure, speed and attack potency; account for soul/spiritual interaction in cross-verse comparison.",
  "Aizen Sosuke": "Use late-series Aizen with Hogyoku evolution/immortality and Kyoka Suigetsu. Perfect hypnosis is a major matchup factor unless the opponent has a credible counter.",
  "Yhwach": "Use endgame Yhwach with The Almighty. Future perception/alteration is a major hax advantage; compare counters to precognition/fate/future manipulation explicitly.",
  "Lucius Zogratis": "Use manga-canon Lucius from Black Clover. Account for Soul Magic, Time Magic and his late-series magical toolkit/Paladin creation; do not confuse him with similarly named characters.",
  "Giorno Giovanna GER": "Use Gold Experience Requiem as named. Return to Zero is the central defensive/causal ability; do not reduce the matchup to physical stats alone.",
  "Johnny Joestar Tusk Act 4": "Use Tusk Act 4 as named. Infinite Rotation and its persistence/cross-dimensional pursuit are the key win conditions, with setup requirements considered.",
  "Funny Valentine D4C Love Train": "Use D4C Love Train as named. Misfortune redirection/dimensional defense is central; consider whether the opponent has a canon-like bypass rather than raw force only.",
  "Enrico Pucci Made in Heaven": "Use Made in Heaven as named. Universal time acceleration and rapidly increasing effective speed are central, but account for initial setup and direct vulnerability.",
  "Dio Over Heaven": "This card explicitly names the licensed game version Heaven Ascension DIO. Use that version's reality-overwrite abilities rather than standard canon DIO.",
  "Sung Jinwoo": "Use peak canonical main-source Sung Jinwoo. Consider Shadow Monarch powers, army, regeneration/immortality-like survivability and late-series scale rather than only early anime feats.",
  "Saiki Kusuo": "Use his established psychic toolkit and limiters. Consider teleportation, mind/physical manipulation and other psychic hax; avoid treating comedy scenes as limitless omnipotence.",
  "Alucard Hellsing": "Use endgame Hellsing Alucard appropriate to the card name. Consider regeneration, souls/familiars and unusual existence conditions; if Schrodinger is relevant, explain why rather than assuming it silently.",
  "Meruem Post-Rose": "Use post-Rose Meruem as named. Superior aura, physical stats, intelligence and evolved abilities versus Hunter x Hunter tiers, without inflating him to cosmic scales."
};

const MODES = {
  "1v1": {label:"1v1", players:2, teams:2, teamSize:1},
  "1v1v1": {label:"1v1v1", players:3, teams:3, teamSize:1},
  "1v1v1v1": {label:"1v1v1v1", players:4, teams:4, teamSize:1},
  "2v2": {label:"2v2", players:4, teams:2, teamSize:2},
  "3v3": {label:"3v3", players:6, teams:2, teamSize:3},
};

const AUCTION_SECONDS = 10;
const BID_RESET_SECONDS = 10;
const BETWEEN_SECONDS = 3;

function sanitizeName(v){return String(v||"Player").trim().slice(0,18)||"Player";}
function code(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="";for(let i=0;i<5;i++)s+=a[Math.floor(Math.random()*a.length)];return s;}
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function getRoom(socket){return rooms.get(socket.data.roomCode);}
function modeInfo(room){return MODES[room.settings.mode]||MODES["1v1"];}
function player(room,id){return room.players.find(p=>p.id===id);}
function clearTimers(room){if(room.auctionTimer)clearTimeout(room.auctionTimer);if(room.nextTimer)clearTimeout(room.nextTimer);}
function teamPublic(room,t){return {id:t.id,name:t.name,memberIds:t.memberIds};}
function publicCard(card){
 if(!card)return null;
 return {id:card.id,name:card.name,categoryId:card.categoryId,categoryName:card.categoryName,categoryIcon:card.categoryIcon,image:card.image||null,paid:card.paid};
}
function publicWinner(w){return w?{id:w.id,name:w.name,bid:w.bid,card:publicCard(w.card)}:null;}
function publicRoom(room){return {
 code:room.code,hostId:room.hostId,phase:room.phase,settings:room.settings,round:room.round,
 currentCard:publicCard(room.currentCard),auctionEndsAt:room.auctionEndsAt,highBid:room.highBid,highBidderId:room.highBidderId,
 passedIds:[...room.passed],lastWinner:publicWinner(room.lastWinner),teams:room.teams.map(t=>teamPublic(room,t)),judge:room.judge,
 players:room.players.map(p=>({id:p.id,name:p.name,cash:p.cash,inventory:p.inventory.map(publicCard),teamId:p.teamId}))
};}
function emitRoom(room){io.to(room.code).emit("room",publicRoom(room));}
function sound(room,type){io.to(room.code).emit("sound",type);}

function placeholder(label){const s=String(label||"?").replace(/[<>&'\"]/g,"").slice(0,28);const init=s.split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="500"><defs><linearGradient id="g"><stop stop-color="#2b3043"/><stop offset="1" stop-color="#131720"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="350" cy="210" r="112" fill="#414860"/><text x="350" y="244" text-anchor="middle" font-family="Arial" font-weight="700" font-size="82" fill="white">${init}</text><text x="350" y="405" text-anchor="middle" font-family="Arial" font-size="29" fill="#d4d7e3">${s}</text></svg>`);}

function normalizeText(v){
 return String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
}
function scoreName(candidate, wanted){
 const a=normalizeText(candidate), b=normalizeText(wanted);
 if(!a||!b)return 0;if(a===b)return 100;if(a.includes(b)||b.includes(a))return 82;
 const aa=new Set(a.split(" ")), bb=new Set(b.split(" "));let same=0;for(const x of aa)if(bb.has(x))same++;
 return Math.round((same/Math.max(aa.size,bb.size))*70);
}
async function jikanImage(query){
 try{
  const u=new URL("https://api.jikan.moe/v4/characters");u.searchParams.set("q",query);u.searchParams.set("limit","8");
  const r=await fetch(u,{headers:{"User-Agent":"ChooseEverything/3.1"},signal:AbortSignal.timeout(6000)});if(!r.ok)return null;
  const d=await r.json();const list=Array.isArray(d?.data)?d.data:[];
  list.sort((x,y)=>Math.max(scoreName(y?.name,query),...(y?.nicknames||[]).map(n=>scoreName(n,query)))-Math.max(scoreName(x?.name,query),...(x?.nicknames||[]).map(n=>scoreName(n,query))));
  const x=list[0];const best=Math.max(scoreName(x?.name,query),...(x?.nicknames||[]).map(n=>scoreName(n,query)));if(best<55)return null;return x?.images?.webp?.large_image_url||x?.images?.jpg?.large_image_url||x?.images?.webp?.image_url||x?.images?.jpg?.image_url||null;
 }catch(e){return null;}
}
async function anilistImage(query){
 try{
  const gql=`query($search:String){Character(search:$search){name{full native alternative} image{large medium}}}`;
  const r=await fetch("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"ChooseEverything/3.1"},body:JSON.stringify({query:gql,variables:{search:query}}),signal:AbortSignal.timeout(6000)});
  if(!r.ok)return null;const d=await r.json();return d?.data?.Character?.image?.large||d?.data?.Character?.image?.medium||null;
 }catch(e){return null;}
}
async function kitsuImage(query){
 try{
  const u=new URL("https://kitsu.io/api/edge/characters");u.searchParams.set("filter[name]",query);u.searchParams.set("page[limit]","5");
  const r=await fetch(u,{headers:{"Accept":"application/vnd.api+json","User-Agent":"ChooseEverything/3.1"},signal:AbortSignal.timeout(6000)});if(!r.ok)return null;
  const d=await r.json();const arr=Array.isArray(d?.data)?d.data:[];arr.sort((a,b)=>scoreName(b?.attributes?.canonicalName,query)-scoreName(a?.attributes?.canonicalName,query));
  const top=arr[0];if(scoreName(top?.attributes?.canonicalName,query)<55)return null;const im=top?.attributes?.image;return im?.original||im?.large||im?.medium||im?.small||null;
 }catch(e){return null;}
}
async function wikipediaImage(query){
 try{
  const u=new URL("https://en.wikipedia.org/w/api.php");u.searchParams.set("action","query");u.searchParams.set("generator","search");u.searchParams.set("gsrsearch",query);u.searchParams.set("gsrlimit","5");u.searchParams.set("prop","pageimages");u.searchParams.set("piprop","thumbnail");u.searchParams.set("pithumbsize","900");u.searchParams.set("format","json");u.searchParams.set("origin","*");
  const r=await fetch(u,{headers:{"User-Agent":"ChooseEverything/3.1"},signal:AbortSignal.timeout(6000)});if(!r.ok)return null;const d=await r.json();
  const pages=Object.values(d?.query?.pages||{});pages.sort((a,b)=>scoreName(b?.title,query)-scoreName(a?.title,query));return pages.find(x=>x?.thumbnail?.source)?.thumbnail?.source||null;
 }catch(e){return null;}
}
async function resolveImage(card){
 if(card.image) return card.image;
 const key=card.id;if(imageCache.has(key))return imageCache.get(key);
 let found=null;
 if(card.categoryId==="anime"){
  const m=animeImageManifest[card.id]||{};const canonical=m.canonical||card.imageQuery||card.query||card.name;const wiki=m.wiki||card.wikiQuery||card.name;
  const providers=Array.isArray(m.providers)&&m.providers.length?m.providers:["anilist","jikan","kitsu","wikipedia"];
  for(const provider of providers){
   if(found)break;
   if(provider==="local"&&m.local)found=m.local;
   else if(provider==="anilist")found=await anilistImage(canonical);
   else if(provider==="jikan")found=await jikanImage(canonical);
   else if(provider==="kitsu")found=await kitsuImage(canonical);
   else if(provider==="wikipedia")found=await wikipediaImage(wiki);
  }
 }else{
  found=await wikipediaImage(card.query||card.name);
 }
 imageCache.set(key,found||"");return found;
}
async function imagePayload(card){
 const key=card.id;
 if(imageBinaryCache.has(key))return imageBinaryCache.get(key);
 const u=await resolveImage(card);
 if(u){
  if(u.startsWith("/")){
   try{const p=path.join(__dirname,"public",u.replace(/^\/+/,""));const buf=await fs.promises.readFile(p);const ext=path.extname(p).toLowerCase();const contentType=ext===".png"?"image/png":ext===".webp"?"image/webp":"image/jpeg";const payload={contentType,buffer:buf};imageBinaryCache.set(key,payload);return payload;}catch(e){}
  }
  try{
   const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0 ChooseEverything/3.2","Accept":"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"},signal:AbortSignal.timeout(8000)});
   if(r.ok){const contentType=r.headers.get("content-type")||"image/jpeg";const buffer=Buffer.from(await r.arrayBuffer());if(buffer.length>0){const payload={contentType,buffer};imageBinaryCache.set(key,payload);return payload;}}
  }catch(e){}
 }
 const payload={contentType:"image/svg+xml",buffer:placeholder(card.name)};imageBinaryCache.set(key,payload);return payload;
}
async function prewarmCardImage(card){if(!card)return;try{await imagePayload(card);}catch(e){}}
app.get("/api/card-image/:id",async(req,res)=>{
 const c=cardMap.get(req.params.id);if(!c)return res.status(404).end();
 res.set("Cache-Control","public, max-age=604800, immutable");
 const payload=await imagePayload(c);
 res.type(payload.contentType).send(payload.buffer);
});
app.get("/api/catalog",(req,res)=>res.json(categories.map(c=>({id:c.id,name:c.name,icon:c.icon,count:c.cards.length}))));
app.get("/api/health",(req,res)=>res.json({ok:true,cards:allCards.length,categories:categories.length,animeImageMappings:Object.keys(animeImageManifest).length,ai:Boolean(process.env.OPENAI_API_KEY),judgeVersion:"3.5-canon-ranking"}));

function assignTeams(room){
 const m=modeInfo(room);const ids=shuffle(room.players.map(p=>p.id));room.teams=[];
 if(m.teamSize===1){ids.forEach((id,i)=>room.teams.push({id:`T${i+1}`,name:`Time ${i+1}`,memberIds:[id]}));}
 else{for(let i=0;i<m.teams;i++)room.teams.push({id:`T${i+1}`,name:`Time ${i+1}`,memberIds:ids.slice(i*m.teamSize,(i+1)*m.teamSize)});}
 for(const t of room.teams)for(const id of t.memberIds){const p=player(room,id);if(p)p.teamId=t.id;}
}
function buildDeck(room){let pool;if(room.settings.categoryId==="mixed")pool=allCards;else pool=(categories.find(c=>c.id===room.settings.categoryId)?.cards||allCards);return shuffle(pool);}
function activeForAuction(room,p){return !room.passed.has(p.id);}
function everyoneDone(room){
 const bidder=room.highBidderId;
 return room.players.every(p=>room.passed.has(p.id)||p.id===bidder);
}
async function beginAuction(room){
 if(room.round>=room.settings.rounds||room.deckIndex>=room.deck.length){return beginJudging(room);}
 room.phase="loadingCard";room.currentCard=room.deck[room.deckIndex++];room.highBid=0;room.highBidderId=null;room.lastWinner=null;room.passed=new Set();room.auctionEndsAt=null;emitRoom(room);
 await prewarmCardImage(room.currentCard);
 if(room.phase!=="loadingCard")return;
 room.phase="auction";room.round++;room.auctionEndsAt=Date.now()+AUCTION_SECONDS*1000;emitRoom(room);sound(room,"round");scheduleEnd(room);
 // Enquanto a rodada atual acontece, prepara a próxima foto em segundo plano.
 prewarmCardImage(room.deck[room.deckIndex]);
}
function resetAuctionClock(room){room.auctionEndsAt=Date.now()+BID_RESET_SECONDS*1000;scheduleEnd(room);}
function scheduleEnd(room){if(room.auctionTimer)clearTimeout(room.auctionTimer);room.auctionTimer=setTimeout(()=>finishAuction(room),Math.max(50,room.auctionEndsAt-Date.now()));}
function finishAuction(room){
 if(room.phase!=="auction")return;const w=player(room,room.highBidderId);if(w&&room.highBid>0){w.cash-=room.highBid;w.inventory.push({...room.currentCard,paid:room.highBid});room.lastWinner={id:w.id,name:w.name,bid:room.highBid,card:room.currentCard};}else room.lastWinner={id:null,name:"Ninguém",bid:0,card:room.currentCard};
 room.phase="between";room.auctionEndsAt=null;emitRoom(room);sound(room,w?"win":"miss");room.nextTimer=setTimeout(()=>beginAuction(room),BETWEEN_SECONDS*1000);
}
function teamRoster(room,t){return t.memberIds.flatMap(id=>{const p=player(room,id);return (p?.inventory||[]).map(c=>({owner:p.name,name:c.name,score:c.score,category:c.categoryName,paid:c.paid,guidance:BATTLE_GUIDANCE[c.name]||null}));});}
const LOCAL_BATTLE_OVERRIDES={
 "Rimuru Tempest":1000,"Anos Voldigoad":1000,"Zeno":990,"Grand Priest":970,"Whis":950,"Dio Over Heaven":940,
 "Yhwach":930,"Giorno Giovanna GER":925,"Black Frieza":920,"Goku Ultra Instinct":910,"Saitama":905,"Aizen Sosuke":900,
 "Sung Jinwoo":895,"Johnny Joestar Tusk Act 4":890,"Funny Valentine D4C Love Train":885,"Cosmic Garou":875
};
function localBattleValue(c){return LOCAL_BATTLE_OVERRIDES[c.name]??c.score??50;}
function localJudge(room){
 const scored=room.teams.map(t=>{const r=teamRoster(room,t);const values=r.map(localBattleValue).sort((a,b)=>b-a);const base=values.reduce((s,v,i)=>s+v*(i===0?1:i<3?.45:.18),0);return {t,score:base,roster:r};}).sort((a,b)=>b.score-a.score);
 const ranking=scored.map(x=>x.t.id);
 const w=scored[0];return {source:"local",winnerTeamId:w?.t.id||null,ranking,confidence:0.58,summary:w?`${w.t.name} leva vantagem pela combinação dos personagens e condições de vitória.`:"Sem vencedor.",reasons:w?[`O fallback usa pesos privados corrigidos para personagens de alto nível e não mostra power aos jogadores.`,`Personagens com hax e versões de fim de obra recebem prioridade sobre simples quantidade de cartas.`,`Ative a IA OpenAI para uma análise de matchup mais detalhada.`]:[]};
}
function normalizeRanking(room, proposed, winnerTeamId, fallbackRanking){
 const valid=new Set(room.teams.map(t=>t.id));
 const out=[];
 const add=id=>{if(valid.has(id)&&!out.includes(id))out.push(id);};
 if(Array.isArray(proposed))for(const id of proposed)add(String(id));
 if(winnerTeamId){const w=String(winnerTeamId);if(valid.has(w)){const i=out.indexOf(w);if(i>=0)out.splice(i,1);out.unshift(w);}}
 if(Array.isArray(fallbackRanking))for(const id of fallbackRanking)add(String(id));
 for(const t of room.teams)add(t.id);
 return out.slice(0,room.teams.length);
}
async function aiJudge(room){
 const fallback=localJudge(room);if(!process.env.OPENAI_API_KEY)return fallback;
 try{
  const OpenAI=require("openai");const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const teams=room.teams.map(t=>({id:t.id,name:t.name,members:t.memberIds.map(id=>player(room,id)?.name),roster:teamRoster(room,t).map(c=>({owner:c.owner,name:c.name,category:c.category,paid:c.paid,canonNote:c.guidance||undefined}))}));
  const prompt=`Você é o juiz final de um jogo de confrontos entre personagens/coleções. Responda APENAS JSON válido.
MODO: ${room.settings.mode}. CATEGORIA: ${room.settings.categoryId}.

REGRAS OBRIGATÓRIAS PARA ANIME/FICÇÃO:
1. Se a carta especifica forma/transformação (ex.: Ultra Instinct, Gear 5, GER, Tusk Act 4, Post-Rose, Founding Titan), use EXATAMENTE essa versão.
2. Se a carta traz só o nome do personagem (ex.: Rimuru Tempest, Anos Voldigoad, Saitama), use a versão CANÔNICA MAIS FORTE já alcançada na fonte principal oficial disponível para esse personagem, não apenas a versão mostrada no começo do anime.
3. Nunca use fanfic, composite não-oficial ou powerscaling de fã como fato. Uma versão licenciada explicitamente nomeada na carta (ex.: Dio Over Heaven) pode ser usada porque a própria carta pediu essa versão.
4. Não decida por popularidade, quantidade de cartas ou preço pago. Compare condições reais de vitória.
5. Analise força/AP, velocidade e reação, resistência, regeneração/imortalidade, alcance, inteligência, hax, manipulação de alma/tempo/espaço/causalidade, resistências, counters e sinergia.
6. Hax importa. Um personagem fisicamente mais forte não vence automaticamente se não tiver resposta para uma habilidade decisiva.
7. Evite NLF: não trate uma habilidade como infinita/absoluta além do que o material sustenta.
8. Em 2v2/3v3, analise a interação entre os membros, proteção, suporte e quem pode neutralizar o principal inimigo.
9. Os campos canonNote abaixo são lembretes privados para reduzir erros conhecidos; use-os junto do seu conhecimento canônico.
10. Em caso realmente debatível, escolha o lado mais provável e reduza confidence, explicando o ponto decisivo.
11. Além do vencedor, RANQUEIE TODOS os times do melhor para o pior. Não deixe nenhum time de fora e não use empates. Em 1v1v1/1v1v1v1 isso deve produzir 1º, 2º, 3º e 4º. Em 2v2/3v3, ranqueie os dois times.

IMPORTANTE: Rimuru Tempest genérico significa Rimuru no auge canônico da light novel, não Rimuru das primeiras temporadas do anime. Ele deve ser tratado como um dos personagens de maior nível desta lista, com Ciel/Azathoth, absorção, Imaginary Space, capacidades espaço-temporais, regeneração/defesas e resistências relevantes. Só faça Rimuru perder quando o adversário/time tiver matchup e feitos/hax plausíveis para superar isso.

Para categorias não-combate (comida, carros, futebol, tecnologia etc.), interprete vencer como melhor conjunto geral naquela categoria.

TIMES: ${JSON.stringify(teams)}

FORMATO EXATO: {"winnerTeamId":"T1","ranking":["T1","T3","T2","T4"],"confidence":0.0,"summary":"explicação curta e específica do matchup","reasons":["motivo 1","motivo 2","motivo 3"]}. O array ranking deve conter TODOS os IDs de time exatamente uma vez, em ordem do 1º ao último.`;
  const resp=await client.responses.create({model:process.env.OPENAI_MODEL||"gpt-5.6",input:prompt});
  const txt=resp.output_text||"";const a=txt.indexOf("{");const b=txt.lastIndexOf("}");if(a<0||b<a)throw new Error("no json");const out=JSON.parse(txt.slice(a,b+1));
  if(!room.teams.some(t=>t.id===out.winnerTeamId))throw new Error("bad team");
  const ranking=normalizeRanking(room,out.ranking,out.winnerTeamId,fallback.ranking);
  const winnerTeamId=ranking[0]||out.winnerTeamId;
  return {source:"openai",winnerTeamId,ranking,confidence:Number(out.confidence)||0.7,summary:String(out.summary||""),reasons:Array.isArray(out.reasons)?out.reasons.slice(0,5):[]};
 }catch(e){return {...fallback,summary:fallback.summary+" A IA externa falhou nesta rodada, então usei o juiz local."};}
}
async function beginJudging(room){room.phase="judging";room.currentCard=null;room.judge=null;emitRoom(room);sound(room,"judge");const result=await aiJudge(room);if(room.phase!=="judging")return;room.judge=result;room.phase="results";emitRoom(room);sound(room,"final");}

io.on("connection",socket=>{
 socket.emit("catalog",categories.map(c=>({id:c.id,name:c.name,icon:c.icon,count:c.cards.length})));
 socket.on("createRoom",({name},cb)=>{let c;do{c=code();}while(rooms.has(c));const room={code:c,hostId:socket.id,phase:"lobby",settings:{categoryId:"anime",rounds:12,startingCash:100,mode:"1v1"},round:0,players:[{id:socket.id,name:sanitizeName(name),cash:100,inventory:[],teamId:null}],teams:[],deck:[],deckIndex:0,currentCard:null,highBid:0,highBidderId:null,passed:new Set(),lastWinner:null,judge:null};rooms.set(c,room);socket.join(c);socket.data.roomCode=c;cb?.({ok:true,code:c});emitRoom(room);});
 socket.on("joinRoom",({name,code:raw},cb)=>{const c=String(raw||"").toUpperCase().trim(),room=rooms.get(c);if(!room)return cb?.({ok:false,error:"Sala não encontrada."});if(room.phase!=="lobby")return cb?.({ok:false,error:"A partida já começou."});if(room.players.length>=6)return cb?.({ok:false,error:"Sala cheia (máximo 6)."});room.players.push({id:socket.id,name:sanitizeName(name),cash:room.settings.startingCash,inventory:[],teamId:null});socket.join(c);socket.data.roomCode=c;cb?.({ok:true,code:c});emitRoom(room);});
 socket.on("settings",data=>{const room=getRoom(socket);if(!room||room.hostId!==socket.id||room.phase!=="lobby")return;const m=MODES[data?.mode]?data.mode:room.settings.mode;const cat=(data?.categoryId==="mixed"||categories.some(c=>c.id===data?.categoryId))?data.categoryId:room.settings.categoryId;const rounds=Math.floor(Number(data?.rounds));const startingCash=Math.floor(Number(data?.startingCash));room.settings={mode:m,categoryId:cat,rounds:Number.isFinite(rounds)?Math.max(1,Math.min(500,rounds)):12,startingCash:Number.isFinite(startingCash)?Math.max(1,Math.min(1000000000,startingCash)):100};room.players.forEach(p=>p.cash=room.settings.startingCash);emitRoom(room);});
 socket.on("startGame",()=>{const room=getRoom(socket);if(!room||room.hostId!==socket.id||room.phase!=="lobby")return;const need=modeInfo(room).players;if(room.players.length!==need)return socket.emit("toast",`O modo ${room.settings.mode} precisa de exatamente ${need} jogadores. Agora há ${room.players.length}.`);clearTimers(room);assignTeams(room);room.players.forEach(p=>{p.cash=room.settings.startingCash;p.inventory=[];});room.deck=buildDeck(room);room.deckIndex=0;room.round=0;room.judge=null;beginAuction(room);});
 socket.on("bid",({amount})=>{const room=getRoom(socket);if(!room||room.phase!=="auction")return;const p=player(room,socket.id);if(!p||room.passed.has(p.id))return socket.emit("toast","Você passou este item.");amount=Math.floor(Number(amount));if(!Number.isFinite(amount))return;const min=room.highBid+1;if(amount<min)return socket.emit("toast",`Lance mínimo: ${min}.`);if(amount>p.cash)return socket.emit("toast","Moedas insuficientes.");room.highBid=amount;room.highBidderId=p.id;resetAuctionClock(room);emitRoom(room);sound(room,"bid");if(everyoneDone(room)){clearTimeout(room.auctionTimer);setTimeout(()=>finishAuction(room),500);}});
 socket.on("cover",()=>{const room=getRoom(socket);if(!room||room.phase!=="auction")return;const p=player(room,socket.id);if(!p||room.passed.has(p.id))return;if(room.highBidderId===p.id)return socket.emit("toast","Você já tem o maior lance.");const amount=room.highBid+1;if(amount>p.cash)return socket.emit("toast","Você não tem moedas para cobrir.");room.highBid=amount;room.highBidderId=p.id;resetAuctionClock(room);emitRoom(room);sound(room,"bid");if(everyoneDone(room)){clearTimeout(room.auctionTimer);setTimeout(()=>finishAuction(room),500);}});
 socket.on("pass",()=>{const room=getRoom(socket);if(!room||room.phase!=="auction")return;if(room.highBidderId===socket.id)return socket.emit("toast","Você está com o maior lance e não pode retirar esse lance.");room.passed.add(socket.id);emitRoom(room);sound(room,"pass");if(everyoneDone(room)){clearTimeout(room.auctionTimer);setTimeout(()=>finishAuction(room),500);}});
 socket.on("backToLobby",()=>{const room=getRoom(socket);if(!room||room.hostId!==socket.id||room.phase!=="results")return;clearTimers(room);room.phase="lobby";room.round=0;room.currentCard=null;room.judge=null;room.teams=[];room.players.forEach(p=>{p.cash=room.settings.startingCash;p.inventory=[];p.teamId=null;});emitRoom(room);});
 socket.on("disconnect",()=>{const room=getRoom(socket);if(!room)return;room.passed.delete(socket.id);room.players=room.players.filter(p=>p.id!==socket.id);if(!room.players.length){clearTimers(room);rooms.delete(room.code);return;}if(room.hostId===socket.id)room.hostId=room.players[0].id;if(room.highBidderId===socket.id){room.highBid=0;room.highBidderId=null;}emitRoom(room);});
});

const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`Choose Everything V3 em http://localhost:${PORT} | ${allCards.length} cartas`));
