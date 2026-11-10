const express=require('express');
const http=require('http');
const {WebSocketServer,WebSocket}=require('ws');
const crypto=require('crypto');
const app=express();app.use(express.static('public'));
const server=http.createServer(app);const wss=new WebSocketServer({server});
const rooms=new Map();
const locations=['1703安全屋','17楼走廊','1704室','1706室'];
const initialItems={'矿泉水':12,'方便面':8,'午餐肉罐头':4,'大米':5,'急救包':1,'羊角锤':1,'菜刀':1,'手电筒':1,'充电宝':1};
function makeRoom(){return {code:'',turn:0,enemy:2,enemyHP:60,enemyAlive:true,doorLocked:true,supplies:{...initialItems},players:[],log:[{t:'系统',msg:'02:55｜末日爆发。你们身处1703，1706的护士林雨晴发来求救信息。'}]};}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function publicRoom(r){return {code:r.code,turn:r.turn,enemy:r.enemy,enemyHP:r.enemyHP,enemyAlive:r.enemyAlive,doorLocked:r.doorLocked,supplies:r.supplies,players:r.players.map(p=>({id:p.id,name:p.name,hp:p.hp,stamina:p.stamina,location:p.location,inventory:p.inventory,connected:p.ws?.readyState===WebSocket.OPEN})),log:r.log.slice(-35)};}
function broadcast(r){const data={type:'state',room:publicRoom(r)};r.players.forEach(p=>send(p.ws,data));}
function note(r,t,msg){r.log.push({t,msg});if(r.log.length>150)r.log.shift();}
function validName(s){return String(s||'幸存者').trim().slice(0,16)||'幸存者';}
function join(ws,r,name,id){let p=id&&r.players.find(x=>x.id===id);if(p){if(p.ws&&p.ws!==ws&&p.ws.readyState===WebSocket.OPEN)p.ws.close(4001,'reconnected');p.ws=ws;note(r,'系统',`${p.name}重新连接。`);}else{if(r.players.length>=2)return send(ws,{type:'error',message:'房间已满（最多2人）'});p={id:crypto.randomUUID(),name:validName(name),hp:100,stamina:100,location:'1703安全屋',inventory:{},ws};r.players.push(p);note(r,'系统',`${p.name}加入了生存小队。`);}ws.room=r.code;ws.player=p.id;send(ws,{type:'joined',playerId:p.id,roomCode:r.code});broadcast(r);}
function act(r,p,action){const loc=p.location;const spend=n=>{if(p.stamina<n)return false;p.stamina-=n;return true;};const give=(item,n)=>{p.inventory[item]=(p.inventory[item]||0)+n;};let msg='';
if(action==='search'){if(loc!=='1703安全屋')return '只有在安全屋才能搜索储备物资。';if(!spend(6))return '体力不足。';const item=Object.keys(r.supplies).find(k=>r.supplies[k]>0);if(!item){p.stamina+=6;return '安全屋可携带物资已经搜完。';}r.supplies[item]--;give(item,1);msg=`找到 ${item} ×1，放入背包。`;}
else if(action==='rest'){p.stamina=Math.min(100,p.stamina+22);msg='休息片刻，恢复22点体力（上限100）。';}
else if(action==='drink'){if(!(p.inventory['矿泉水']>0))return '背包里没有矿泉水。';p.inventory['矿泉水']--;p.stamina=Math.min(100,p.stamina+12);msg='喝下一瓶水，恢复12点体力。';}
else if(action==='heal'){if(!(p.inventory['急救包']>0))return '背包里没有急救包。';p.inventory['急救包']--;p.hp=Math.min(100,p.hp+35);msg='使用急救包，恢复35点生命。';}
else if(action.startsWith('go:')){const target=action.slice(3);if(!locations.includes(target))return '无效地点。';if(!spend(5))return '体力不足。';if(target==='17楼走廊'&&r.doorLocked){p.stamina+=5;return '防盗门仍反锁，先选择解锁门。';}if(target==='1706室'&&loc!=='17楼走廊'){p.stamina+=5;return '必须先到走廊。';}if(target==='1704室'&&loc!=='17楼走廊'){p.stamina+=5;return '必须先到走廊。';}if(target==='1703安全屋'&&loc!=='17楼走廊'&&loc!=='1703安全屋'){p.stamina+=5;return '必须先返回走廊。';}if(target==='17楼走廊'&&loc==='1703安全屋'&&r.enemyAlive){p.hp=Math.max(0,p.hp-12);msg='你进入走廊，遭遇感染者突袭，损失12点生命！';}else msg=`移动到${target}。`;p.location=target;if(target==='1706室'&&!r.enemyAlive)msg+=' 林雨晴打开了门：谢谢你们！我可以帮忙包扎。';}
else if(action==='unlock'){if(loc!=='1703安全屋')return '需要在安全屋才能操作门锁。';r.doorLocked=false;msg='解开1703防盗门的反锁。走廊仍可能有危险！';}
else if(action==='lock'){if(loc!=='1703安全屋')return '需要在安全屋才能锁门。';r.doorLocked=true;msg='重新反锁防盗门。';}
else if(action==='attack'){if(loc!=='17楼走廊')return '感染者在走廊，必须先到走廊才能攻击。';if(!r.enemyAlive)return '感染者已经被击倒。';if(!spend(18))return '体力不足，无法攻击。';const armed=(p.inventory['羊角锤']||0)+(p.inventory['菜刀']||0)>0;const dmg=armed?30:12;r.enemyHP=Math.max(0,r.enemyHP-dmg);msg=`${armed?'使用武器':'徒手'}攻击感染者，造成${dmg}点伤害。`;if(r.enemyHP===0){r.enemyAlive=false;msg+=' 感染者倒下了！';}else{p.hp=Math.max(0,p.hp-8);msg+=' 感染者反击，你损失8点生命。';}}
else if(action==='inspect'){msg=loc==='1703安全屋'?'你确认了物资和门锁状况。':loc==='17楼走廊'?'走廊昏暗，1704门敞开，1706有幸存者。':loc==='1704室'?'房间空荡，角落传来令人不安的声音。':'林雨晴表示愿意分享医疗知识。';}
else return '未知行动。';r.turn++;note(r,p.name,msg);if(p.hp===0)note(r,'系统',`${p.name}重伤倒地！需要队友援助。`);return null;}
wss.on('connection',ws=>{ws.on('message',raw=>{try{if(raw.length>4096)return send(ws,{type:'error',message:'消息过长'});const m=JSON.parse(raw);if(m.type==='create'){const r=makeRoom();let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(code));r.code=code;rooms.set(code,r);join(ws,r,m.name);return;}if(m.type==='join'){const r=rooms.get(String(m.code||'').toUpperCase());if(!r)return send(ws,{type:'error',message:'房间不存在或服务器已重启'});join(ws,r,m.name,m.playerId);return;}const r=rooms.get(ws.room),p=r?.players.find(x=>x.id===ws.player);if(!r||!p||p.ws!==ws)return send(ws,{type:'error',message:'请先加入房间'});if(m.type==='action'){if(p.hp<=0)return send(ws,{type:'error',message:'角色已倒地，暂时无法行动'});const err=act(r,p,String(m.action||''));if(err)return send(ws,{type:'error',message:err});broadcast(r);}if(m.type==='chat'){const msg=String(m.message||'').trim().slice(0,160);if(msg){note(r,p.name,'💬 '+msg);broadcast(r);}}}catch(e){send(ws,{type:'error',message:'请求格式错误'});}});ws.on('close',()=>{const r=rooms.get(ws.room);if(r){note(r,'系统','一名玩家断开连接，可使用原房间码重新加入。');broadcast(r);}});});
setInterval(()=>{for(const [code,r] of rooms){if(r.players.every(p=>p.ws?.readyState!==WebSocket.OPEN)&&r.turn===0)rooms.delete(code);}},3600000);
const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log('Zero Infection running on '+port));
