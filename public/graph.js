import { pieces } from './engine.js';

export class GraphView {
  constructor(canvas, overlay, model, onSelect) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.model = model;
    this.onSelect = onSelect;
    this.positions = model.positions.map((position) => [...position]);
    this.counts = [0, 0, 0];
    this.options = { color: 'structure', solutions: true, path: true, local: false };
    this.current = model.initial;
    this.autoRotate = false;
    this.reset();
    const gl = (this.gl = canvas.getContext('webgl', { alpha: true, antialias: true }));
    if (!gl) throw Error('当前浏览器未开启 WebGL，请开启硬件加速后重试。');
    const compile = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = (this.program = gl.createProgram());
    gl.attachShader(
      program,
      compile(
        gl.VERTEX_SHADER,
        `
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
      }`,
      ),
    );
    gl.attachShader(
      program,
      compile(
        gl.FRAGMENT_SHADER,
        `precision mediump float; varying vec4 vColor; void main(){gl_FragColor=vColor;}`,
      ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(program));
    this.locations = {};
    for (const k of ['rotation', 'aspect', 'pan', 'zoom', 'pointSize'])
      this.locations[k] = gl.getUniformLocation(program, k);
    this.position = gl.getAttribLocation(program, 'position');
    this.color = gl.getAttribLocation(program, 'color');
    this.buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
    this.edges = [];
    model.nodes.forEach((n, i) =>
      n.neighbors.forEach((j) => {
        if (j > i) this.edges.push([i, j]);
      }),
    );
    this.maxDistance = Math.max(...model.distances);
    this.relations = model.nodes.map((n) => {
      const ps = pieces(n.board),
        big = ps.find((p) => p.w === 2 && p.h === 2),
        bar = ps.find((p) => p.w === 2 && p.h === 1);
      return big.y + big.h <= bar.y ? 0 : big.y >= bar.bottom ? 3 : big.y > bar.y ? 2 : 1;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.35, Math.min(14, this.zoom * Math.exp(-e.deltaY * 0.001)));
        this.dirty = true;
      },
      { passive: false },
    );
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      if (e.shiftKey || e.buttons & 4) {
        this.pan[0] += (dx * 2) / this.width;
        this.pan[1] -= (dy * 2) / this.height;
      } else {
        this.yaw += dx * 0.006;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.006));
      }
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.dirty = true;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.drag && Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < 5) {
        const rect = canvas.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top;
        let best = -1,
          distance = 13;
        model.nodes.forEach((n, i) => {
          if (this.options.local && !this.neighborhood.has(i)) return;
          const p = this.project(i);
          const d = Math.hypot(p[0] - x, p[1] - y);
          if (d < distance) {
            best = i;
            distance = d;
          }
        });
        if (best >= 0) this.onSelect(best);
      }
      this.drag = null;
    });
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    canvas.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '0'].includes(e.key))
        e.preventDefault();
      if (e.key === 'ArrowLeft') this.yaw -= 0.08;
      if (e.key === 'ArrowRight') this.yaw += 0.08;
      if (e.key === 'ArrowUp') this.pitch -= 0.08;
      if (e.key === 'ArrowDown') this.pitch += 0.08;
      if (e.key === '+') this.zoom = Math.min(14, this.zoom * 1.15);
      if (e.key === '-') this.zoom = Math.max(0.35, this.zoom / 1.15);
      if (e.key === '0') this.reset();
      this.dirty = true;
    });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.update(this.current, {}, true);
    this.resize();
    const loop = (now) => {
      if (this.autoRotate) {
        this.yaw += Math.min(50, now - (this.lastTime || now)) * 0.00009;
        this.dirty = true;
      }
      this.lastTime = now;
      if (this.dirty) this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  reset() {
    this.yaw = 0.38;
    this.pitch = 0.13;
    this.zoom = 1.12;
    this.pan = [0, 0];
    this.dirty = true;
  }
  setPositions(positions) {
    if (
      !Array.isArray(positions) ||
      positions.length !== this.model.nodes.length ||
      positions.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 3 ||
          point.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw Error('布局坐标不完整');
    }
    // 视图拥有坐标副本。切换布局不修改棋盘、邻接表或原始坐标。
    this.positions = positions.map((point) => [...point]);
    this.update(this.current, {}, true);
    this.reset();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    this.dpr = Math.min(devicePixelRatio, 2);
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    this.dirty = true;
  }
  projectionScale() {
    return Math.min(this.width * 0.4, this.height * 0.48);
  }
  project(i) {
    // 与顶点着色器使用相同的正交投影，用于拾取和当前节点标记。
    const [px, py, pz] = this.positions[i];
    const x = px * Math.cos(this.yaw) + pz * Math.sin(this.yaw);
    const z = -px * Math.sin(this.yaw) + pz * Math.cos(this.yaw);
    const y = py * Math.cos(this.pitch) - z * Math.sin(this.pitch);
    const scale = this.projectionScale() * this.zoom;
    return [
      this.width * 0.5 + x * scale + this.pan[0] * this.width * 0.5,
      this.height * 0.5 + y * scale - this.pan[1] * this.height * 0.5,
    ];
  }
  upload(index, vertices) {
    const gl = this.gl;
    this.counts[index] = vertices.length / 7;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[index]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  }
  update(current = this.current, options = {}, force = false) {
    const previous = this.options;
    const next = { ...previous, ...options };
    const moved = current !== this.current;
    const localChanged = next.local !== previous.local;
    const neighborhoodChanged = localChanged || (next.local && moved);
    this.current = current;
    this.options = next;

    // 只有开启局部视图才计算八步邻域；相机旋转与普通棋子选择不触发 BFS。
    if (next.local && (force || neighborhoodChanged)) {
      this.neighborhood = new Set([current]);
      let frontier = [current];
      for (let depth = 0; depth < 8; depth++) {
        const following = [];
        for (const i of frontier) {
          for (const j of this.model.nodes[i].neighbors) {
            if (this.neighborhood.has(j)) continue;
            this.neighborhood.add(j);
            following.push(j);
          }
        }
        frontier = following;
      }
    }
    // 全局视图走一步时保留边与解集缓冲，只更新最短路径。
    if (force || neighborhoodChanged || next.color !== previous.color) {
      const colors = this.model.nodes.map((node, i) => {
        let rgb = [0.53, 0.64, 0.82];
        if (next.color === 'distance') {
          const t = this.model.distances[i] / this.maxDistance;
          rgb = [0.44 + 0.44 * t, 0.86 - 0.42 * t, 0.72 + 0.16 * t];
        }
        if (next.color === 'relation')
          rgb = [
            [0.95, 0.36, 0.45],
            [1, 0.65, 0.31],
            [0.95, 0.86, 0.42],
            [0.57, 0.92, 0.52],
          ][this.relations[i]];
        return [...rgb, next.local && !this.neighborhood.has(i) ? 0.024 : 0.34];
      });
      const lines = [];
      for (const edge of this.edges) {
        for (const i of edge) lines.push(...this.positions[i], ...colors[i]);
      }
      this.upload(0, lines);
    }
    if (force || neighborhoodChanged || next.solutions !== previous.solutions) {
      const dots = [];
      this.model.nodes.forEach((node, i) => {
        if (
          next.solutions &&
          this.model.distances[i] === 0 &&
          (!next.local || this.neighborhood.has(i))
        ) {
          dots.push(...this.positions[i], 0.71, 0.98, 0.55, 0.9);
        }
      });
      this.upload(1, dots);
    }
    if (force || moved || next.path !== previous.path) {
      const lines = [];
      if (next.path) {
        const path = this.model.path(current);
        for (let i = 1; i < path.length; i++) {
          for (const node of [path[i - 1], path[i]])
            lines.push(...this.positions[node], 0.4, 0.91, 0.81, 1);
        }
      }
      this.upload(2, lines);
    }
    this.dirty = true;
  }
  render() {
    if (!this.width || !this.height) return;
    this.dirty = false;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const s = this.projectionScale();
    gl.uniform2f(this.locations.rotation, this.yaw, this.pitch);
    gl.uniform2f(this.locations.aspect, (s * 2) / this.width, (s * 2) / this.height);
    gl.uniform2f(this.locations.pan, ...this.pan);
    gl.uniform1f(this.locations.zoom, this.zoom);
    gl.uniform1f(this.locations.pointSize, 2.6 * this.dpr);
    this.buffers.forEach((b, i) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(this.position);
      gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(this.color);
      gl.vertexAttribPointer(this.color, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(i === 1 ? gl.POINTS : gl.LINES, 0, this.counts[i]);
    });
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    const [x, y] = this.project(this.current);
    c.shadowColor = '#ffc395';
    c.shadowBlur = 18;
    c.fillStyle = '#ffca98';
    c.beginPath();
    c.arc(x, y, 4, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#ffc395a0';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(x, y, 9, 0, Math.PI * 2);
    c.stroke();
    c.font = '12px system-ui';
    c.fillStyle = '#efc7a4';
    c.fillText('你在这里', x + 15, y - 12);
  }
}
