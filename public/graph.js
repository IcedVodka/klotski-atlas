import { pieces } from './engine.js';

export class GraphView {
  constructor(canvas, overlay, model, onSelect) {
    this.canvas = canvas; this.overlay = overlay; this.ctx = overlay.getContext('2d');
    this.model = model; this.onSelect = onSelect;
    this.options = { color: 'structure', solutions: true, path: true, local: false };
    this.current = model.initial; this.autoRotate = false; this.reset();
    const gl = this.gl = canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!gl) throw Error('当前浏览器未开启 WebGL，请开启硬件加速后重试。');
    const compile = (type, text) => {
      const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s;
    };
    const program = this.program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
      attribute vec3 position; attribute vec4 color;
      uniform vec2 rotation; uniform vec2 aspect; uniform vec2 pan; uniform float zoom; uniform float pointSize;
      varying vec4 vColor;
      void main() {
        float x=position.x*cos(rotation.x)+position.z*sin(rotation.x);
        float z=-position.x*sin(rotation.x)+position.z*cos(rotation.x);
        float y=position.y*cos(rotation.y)-z*sin(rotation.y);
        float depth=position.y*sin(rotation.y)+z*cos(rotation.y);
        gl_Position=vec4(vec2(x,-y)*aspect*zoom+pan,depth*.2,1.);
        gl_PointSize=pointSize;
        vColor=vec4(color.rgb,color.a*(.75+.25*(depth+1.)*.5));
      }`));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision mediump float; varying vec4 vColor; void main(){gl_FragColor=vColor;}`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    this.locations = {};
    for (const k of ['rotation','aspect','pan','zoom','pointSize']) this.locations[k] = gl.getUniformLocation(program,k);
    this.position = gl.getAttribLocation(program, 'position'); this.color = gl.getAttribLocation(program, 'color');
    this.buffers = [gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];
    this.edges = [];
    model.nodes.forEach((n,i) => n[4].forEach(j => { if(j > i) this.edges.push([i,j]); }));
    this.maxDistance = Math.max(...model.distances);
    this.relations = model.nodes.map(n => {
      const ps = pieces(n[0]), big = ps.find(p => p.w===2 && p.h===2), bar = ps.find(p=>p.w===2&&p.h===1);
      return big.y+big.h<=bar.y ? 0 : big.y>=bar.bottom ? 3 : big.y>bar.y ? 2 : 1;
    });
    canvas.addEventListener('wheel', e => {e.preventDefault();this.zoom = Math.max(.35,Math.min(14,this.zoom*Math.exp(-e.deltaY*.001)));this.dirty=true;},{passive:false});
    canvas.addEventListener('pointerdown', e => {this.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove', e => {
      if(!this.drag)return;
      const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
      if(e.shiftKey || e.button===1){this.pan[0]+=dx*2/this.width;this.pan[1]-=dy*2/this.height;}
      else {this.yaw+=dx*.006;this.pitch=Math.max(-1.5,Math.min(1.5,this.pitch+dy*.006));}
      this.drag.x=e.clientX;this.drag.y=e.clientY;this.dirty=true;
    });
    canvas.addEventListener('pointerup',e=>{
      if(this.drag && Math.hypot(e.clientX-this.drag.startX,e.clientY-this.drag.startY)<5){
        const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
        let best=-1, distance=13;
        model.nodes.forEach((n,i)=>{if(this.options.local&&!this.neighborhood.has(i))return;const p=this.project(i);const d=Math.hypot(p[0]-x,p[1]-y);if(d<distance){best=i;distance=d;}});
        if(best>=0)this.onSelect(best);
      }
      this.drag=null;
    });
    canvas.addEventListener('pointercancel',()=>this.drag=null);
    canvas.addEventListener('keydown', e=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','0'].includes(e.key))e.preventDefault();
      if(e.key==='ArrowLeft')this.yaw-=.08;if(e.key==='ArrowRight')this.yaw+=.08;
      if(e.key==='ArrowUp')this.pitch-=.08;if(e.key==='ArrowDown')this.pitch+=.08;
      if(e.key==='+')this.zoom=Math.min(14,this.zoom*1.15);if(e.key==='-')this.zoom=Math.max(.35,this.zoom/1.15);if(e.key==='0')this.reset();this.dirty=true;
    });
    new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
    this.update();this.resize();
    const loop = now=>{if(this.autoRotate){this.yaw+=Math.min(50,now-(this.lastTime||now))*.00009;this.dirty=true;}this.lastTime=now;if(this.dirty)this.render();requestAnimationFrame(loop);};requestAnimationFrame(loop);
  }
  reset(){this.yaw=.38;this.pitch=.13;this.zoom=1;this.pan=[0,-.01];this.dirty=true;}
  setPositions(positions){
    if(positions.length!==this.model.nodes.length || positions.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v))))throw Error('布局坐标不完整');
    positions.forEach((p,i)=>{this.model.nodes[i].splice(1,3,...p);});
    this.update();this.reset();
  }
  resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;this.dpr=Math.min(devicePixelRatio,2);for(const c of [this.canvas,this.overlay]){c.width=Math.round(r.width*this.dpr);c.height=Math.round(r.height*this.dpr);}this.dirty=true;}
  project(i){const p=this.model.nodes[i],x=p[1]*Math.cos(this.yaw)+p[3]*Math.sin(this.yaw),z=-p[1]*Math.sin(this.yaw)+p[3]*Math.cos(this.yaw),y=p[2]*Math.cos(this.pitch)-z*Math.sin(this.pitch);const s=Math.min(this.width*.46,this.height*.32)*this.zoom;return [this.width*.5+x*s+this.pan[0]*this.width*.5,this.height*.5+y*s-this.pan[1]*this.height*.5];}
  update(current=this.current, options={}){
    this.current=current;Object.assign(this.options,options);
    this.neighborhood=new Set([current]);let frontier=[current];
    for(let d=0;d<8;d++){const next=[];for(const i of frontier)for(const j of this.model.nodes[i][4])if(!this.neighborhood.has(j)){this.neighborhood.add(j);next.push(j);}frontier=next;}
    const colors=this.model.nodes.map((n,i)=>{
      let rgb=[.53,.64,.82];
      if(this.options.color==='distance'){const t=this.model.distances[i]/this.maxDistance;rgb=[.44+.44*t,.86-.42*t,.72+.16*t];}
      if(this.options.color==='relation')rgb=[[.95,.36,.45],[1,.65,.31],[.95,.86,.42],[.57,.92,.52]][this.relations[i]];
      return [...rgb,this.options.local&&!this.neighborhood.has(i)?.024:.28];
    });
    const lines=[];for(const [i,j] of this.edges){for(const k of [i,j])lines.push(...this.model.nodes[k].slice(1,4),...colors[k]);}
    const dots=[];this.model.nodes.forEach((n,i)=>{if(this.options.solutions&&this.model.distances[i]===0&&(!this.options.local||this.neighborhood.has(i)))dots.push(...n.slice(1,4),.71,.98,.55,.9);});
    const path=[];if(this.options.path){const p=this.model.path(current);for(let i=1;i<p.length;i++)for(const k of [p[i-1],p[i]])path.push(...this.model.nodes[k].slice(1,4),.40,.91,.81,1);}
    this.counts=[lines.length/7,dots.length/7,path.length/7];
    const gl=this.gl;[lines,dots,path].forEach((a,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers[i]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.DYNAMIC_DRAW);});this.dirty=true;
  }
  render(){
    this.dirty=false;const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    const s=Math.min(this.width*.46,this.height*.32);
    gl.uniform2f(this.locations.rotation,this.yaw,this.pitch);gl.uniform2f(this.locations.aspect,s*2/this.width,s*2/this.height);gl.uniform2f(this.locations.pan,...this.pan);gl.uniform1f(this.locations.zoom,this.zoom);gl.uniform1f(this.locations.pointSize,2.6*this.dpr);
    this.buffers.forEach((b,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,28,0);gl.enableVertexAttribArray(this.color);gl.vertexAttribPointer(this.color,4,gl.FLOAT,false,28,12);gl.drawArrays(i===1?gl.POINTS:gl.LINES,0,this.counts[i]);});
    const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);
    const [x,y]=this.project(this.current);
    c.shadowColor='#ffc395';c.shadowBlur=18;c.fillStyle='#ffca98';c.beginPath();c.arc(x,y,4,0,Math.PI*2);c.fill();c.shadowBlur=0;c.strokeStyle='#ffc395a0';c.lineWidth=1;c.beginPath();c.arc(x,y,9,0,Math.PI*2);c.stroke();
    c.font='10px system-ui';c.fillStyle='#efc7a4';c.fillText('你在这里',x+15,y-12);
  }
}
