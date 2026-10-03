import { pieces, canonical, move, createModel } from './engine.js';
import { GraphView } from './graph.js';
const $=id=>document.getElementById(id);
let model,view,board,current,count=0,selected=null,history=[],timer=null,mode=null,drag=null;
const palette=['#b2bbd2','#aaa1c5','#76aeb2','#7fa0c9','#cf9d8e','#bdac7c','#99b7a7','#ba94a7'];
let identities=new Map();
function stop(){clearTimeout(timer);timer=null;mode=null;$('play').textContent='▶ 播放最短解';$('random').textContent='随机漫游';}
function setBoard(next,record=true){if(record)history.push({board,count});board=next;current=model.index.get(canonical(board));if(record)count++;render();}
function jump(i){stop();selected=null;identities.clear();history=[];count=0;setBoard(model.nodes[i][0],false);$('status').textContent='已跳转到选中局面，可从这里继续探索。';}
function render(){
  const ps=pieces(board),active=new Set(ps.map(p=>p.id));
  for(const el of $('board').children)if(!active.has(el.dataset.id))el.remove();
  for(const p of ps){
    let el=$('board').querySelector(`[data-id="${p.id}"]`);
    if(!el){el=document.createElement('button');el.className='piece';el.dataset.id=p.id;$('board').append(el);}
    if(!identities.has(p.id))identities.set(p.id,palette[identities.size%palette.length]);
    const big=p.w===2&&p.h===2;
    el.style.cssText=`left:${p.x*50+2}px;top:${p.y*50+2}px;width:${p.w*50-4}px;height:${p.h*50-4}px;--piece:${big?'#b4d890':p.w===2?'#d3ac75':identities.get(p.id)}`;
    el.classList.toggle('big',big);el.classList.toggle('selected',selected===p.id);el.textContent=big?'出口 ↓':'';
    el.setAttribute('aria-label',`${big?'目标大方块':p.w===2?'横条':'棋子 '+p.id}，第 ${p.y+1} 行第 ${p.x+1} 列`);
    el.setAttribute('aria-pressed',selected===p.id);
  }
  $('moves').textContent=count;$('distance').textContent=model.distances[current];$('choices').textContent=model.nodes[current][4].length;
  $('node-id').textContent='STATE '+String(current+1).padStart(5,'0');
  $('undo').disabled=!history.length;
  $('play').disabled=$('step').disabled=model.distances[current]===0;
  $('status').textContent=model.distances[current]===0?'到达出口！你已走通这片局面空间。':'目标不变：让大方块到达下方中央。';
  view.update(current);
}
function tryMove(id,dx,dy){stop();const next=move(board,id,dx,dy);if(next&&model.index.has(canonical(next))){setBoard(next);return true;}$('status').textContent='这个方向被挡住了，试试其他棋子。';return false;}
function nextStep(random=false){
  if(!random&&model.distances[current]===0){stop();return false;}
  const neighbors=model.nodes[current][4];
  const prev=history.length?model.index.get(canonical(history.at(-1).board)):-1;
  const available=neighbors.filter(i=>i!==prev),pool=available.length?available:neighbors;
  const target=random?pool[Math.floor(Math.random()*pool.length)]:model.path(current)[1];
  const next=model.boardForNeighbor(board,target);
  if(!next){stop();$('status').textContent='无法匹配下一步棋盘，请重置后重试。';return false;}
  setBoard(next);if(!random&&model.distances[current]===0)stop();return true;
}
function play(random=false){const wanted=random?'random':'solve';if(mode===wanted){stop();return;}stop();mode=wanted;selected=null;
  $('play').textContent=random?'▶ 播放最短解':'Ⅱ 暂停播放';$('random').textContent=random?'停止漫游':'随机漫游';
  const tick=()=>{if(!mode)return;if(nextStep(random)&&mode)timer=setTimeout(tick,1000/Number($('speed').value));};tick();
}
async function init(){
  const response=await fetch('./graph.json');if(!response.ok)throw Error('局面数据加载失败，请刷新重试。');const data=await response.json();model=createModel(data);board=data.initial;current=model.initial;
  view=new GraphView($('graph'),$('overlay'),model,jump);
  const originalPositions=model.nodes.map(n=>n.slice(1,4));
  let rebuiltPositions=null,activeLayout='original';
  $('layout').disabled=false;
  $('layout').onchange=async()=>{
    stop();const wanted=$('layout').value;$('layout').disabled=true;
    try{
      if(wanted==='rebuilt'&&!rebuiltPositions){
        const r=await fetch('./layout-rebuilt.json');if(!r.ok)throw Error('重新生成的布局加载失败');
        const result=await r.json();rebuiltPositions=result.positions;
      }
      view.setPositions(wanted==='original'?originalPositions:rebuiltPositions);activeLayout=wanted;
      $('layout-note').textContent=wanted==='original'?'作者公开的预计算坐标':'从连线重新计算 · 力导向 + 镜像约束 · 非逐点还原';
      const url=new URL(location.href);if(wanted==='original')url.searchParams.delete('layout');else url.searchParams.set('layout','rebuilt');window.history.replaceState(null,'',url);
    }catch(error){$('layout').value=activeLayout;$('status').textContent=error.message;}
    finally{$('layout').disabled=false;}
  };
  for(const id of ['play','step','random','reset'])$(id).disabled=false;
  $('loading').remove();$('graph-count').textContent=`${model.nodes.length.toLocaleString()} 个局面 · ${model.solutionCount} 个出口局面`;
  render();
  $('board').addEventListener('pointerdown',e=>{const el=e.target.closest('.piece');if(!el)return;stop();selected=el.dataset.id;drag={id:selected,x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);render();});
  $('board').addEventListener('pointerup',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.max(Math.abs(dx),Math.abs(dy))>12)tryMove(drag.id,Math.abs(dx)>Math.abs(dy)?Math.sign(dx):0,Math.abs(dy)>=Math.abs(dx)?Math.sign(dy):0);drag=null;});
  $('board').addEventListener('pointercancel',()=>drag=null);
  $('board').addEventListener('click',e=>{const el=e.target.closest('.piece');if(el){selected=el.dataset.id;render();}});
  document.addEventListener('keydown',e=>{if(e.target.closest('#graph')||['INPUT','SELECT'].includes(e.target.tagName))return;const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(selected&&dirs[e.key]){e.preventDefault();tryMove(selected,...dirs[e.key]);}});
  $('step').onclick=()=>{stop();nextStep();};$('play').onclick=()=>play();$('random').onclick=()=>play(true);
  $('reset').onclick=()=>{stop();history=[];count=0;selected=null;identities.clear();setBoard(data.initial,false);};
  $('undo').onclick=()=>{stop();const last=history.pop();if(last){board=last.board;count=last.count;current=model.index.get(canonical(board));render();}};
  $('speed').oninput=()=>{$('speed-value').textContent=$('speed').value+' 步/秒';};
  $('home-view').onclick=()=>view.reset();$('rotate').onclick=()=>{view.autoRotate=!view.autoRotate;$('rotate').setAttribute('aria-pressed',view.autoRotate);};
  for(const id of ['show-path','show-solutions','local','color'])$(id).onchange=()=>{
    view.update(current,{path:$('show-path').checked,solutions:$('show-solutions').checked,local:$('local').checked,color:$('color').value});
    $('color-legend').textContent={structure:'连线表示一次合法移动 · 空间位置由布局决定',distance:'青绿：接近出口 → 紫红：远离出口',relation:'红：方块在横条上方 · 橙：并排 · 黄：部分越过 · 绿：已在下方'}[$('color').value]+($('local').checked?' · 高亮当前局面 8 步内邻域':'');
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  if(new URLSearchParams(location.search).get('layout')==='rebuilt'){$('layout').value='rebuilt';await $('layout').onchange();}
}
init().catch(error=>{$('status').textContent=error.message;const loading=$('loading');if(loading)loading.textContent=error.message;console.error(error);});
