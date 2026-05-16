globalThis.process??={};globalThis.process.env??={};const ie=`
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,le=`
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_glyphs;
uniform vec2 u_resolution;
uniform vec2 u_cellSize;
uniform vec2 u_gridSize;
uniform float u_numChars;
uniform float u_brightnessBoost;
uniform float u_posterize;
uniform float u_revealT;
uniform float u_parallaxX;
uniform float u_parallaxY;
uniform float u_glitchSeed;
uniform float u_scale;

// hash for glitch + cell seed
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 px = vec2(v_uv.x, v_uv.y) * u_resolution;

  // parallax offset
  px -= vec2(u_parallaxX, u_parallaxY * 0.6);

  // glitch: random row offsets
  float rowIdx = floor(px.y / u_cellSize.y);
  float glitchH = hash(vec2(rowIdx, u_glitchSeed));
  float glitchActive = step(0.92, glitchH); // ~8% of rows
  float glitchOffset = (hash(vec2(rowIdx + 100.0, u_glitchSeed)) - 0.5) * u_cellSize.x * 6.0;
  px.x -= glitchActive * glitchOffset;

  vec2 cellIdx = floor(px / u_cellSize);
  vec2 cellFrac = fract(px / u_cellSize);

  if (cellIdx.x < 0.0 || cellIdx.y < 0.0 || cellIdx.x >= u_gridSize.x || cellIdx.y >= u_gridSize.y) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // sample image at cell center (with scale)
  vec2 imageUV = (cellIdx + 0.5) / u_gridSize;
  imageUV = (imageUV - 0.5) / u_scale + 0.5;
  if (imageUV.x < 0.0 || imageUV.x > 1.0 || imageUV.y < 0.0 || imageUV.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  vec4 texColor = texture2D(u_image, imageUV);
  if (texColor.a < 0.04) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // luminance
  float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
  lum = min(1.0, lum * u_brightnessBoost * texColor.a);
  lum = floor(lum * u_posterize + 0.5) / u_posterize;
  if (lum < 0.03) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // reveal wave: edge distance + cell seed
  float edgeDist = min(cellIdx.x / u_gridSize.x, 1.0 - cellIdx.x / u_gridSize.x);
  float cellSeed = hash(cellIdx) * 0.15;
  float threshold = edgeDist + cellSeed;
  float revealWave = u_revealT * 0.3;
  if (threshold > revealWave) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  float cellReveal = min(1.0, (revealWave - threshold) * 6.0);

  // depth fade from center
  vec2 mid = u_gridSize * 0.5;
  float distFromCenter = length((cellIdx - mid) / mid);
  float depthFade = max(0.3, 1.0 - distFromCenter * 0.5);
  float bright = lum * cellReveal * depthFade;

  // char index
  float charF = floor(min(1.0, lum) * (u_numChars - 1.0));

  // sample glyph atlas
  float atlasU = (charF + cellFrac.x) / u_numChars;
  float glyphA = texture2D(u_glyphs, vec2(atlasU, cellFrac.y)).a;

  if (glyphA < 0.01) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // default color: blue-tinted gradient
  float cr = (100.0 + bright * 155.0) / 255.0;
  float cg = (140.0 + bright * 115.0) / 255.0;
  float cb = (200.0 + bright * 55.0) / 255.0;

  gl_FragColor = vec4(cr * glyphA, cg * glyphA, cb * glyphA, glyphA);
}`;function ce(S){const{canvas:m,imageSrc:j,chars:w=" 0123456789",fontSize:A=9,fontFamily:B='"DM Mono", monospace',brightnessBoost:J=2.2,posterize:V=32,parallaxStrength:P=8,scale:H=1.15,colorFn:K}=S;if(K)return se(S);let c=0,x=0,p=0,T=0,y=0,r=0,n=0,f=0,C=0,M=0,I=0,L=0,N=0,b=0,D=!1;const U=l=>{I=(l.clientX/window.innerWidth-.5)*2,L=(l.clientY/window.innerHeight-.5)*2};document.addEventListener("mousemove",U,{passive:!0});const e=m.getContext("webgl",{alpha:!0,premultipliedAlpha:!0,antialias:!1});e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA);function z(l,_){const d=e.createShader(_);if(e.shaderSource(d,l),e.compileShader(d),!e.getShaderParameter(d,e.COMPILE_STATUS))throw new Error(e.getShaderInfoLog(d));return d}const t=e.createProgram();e.attachShader(t,z(ie,e.VERTEX_SHADER)),e.attachShader(t,z(le,e.FRAGMENT_SHADER)),e.linkProgram(t),e.useProgram(t);const s=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,s),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW);const X=e.getAttribLocation(t,"a_pos");e.enableVertexAttribArray(X),e.vertexAttribPointer(X,2,e.FLOAT,!1,0,0);const Q=e.getUniformLocation(t,"u_resolution"),Z=e.getUniformLocation(t,"u_cellSize"),G=e.getUniformLocation(t,"u_gridSize"),$=e.getUniformLocation(t,"u_numChars"),a=e.getUniformLocation(t,"u_brightnessBoost"),i=e.getUniformLocation(t,"u_posterize"),o=e.getUniformLocation(t,"u_revealT"),R=e.getUniformLocation(t,"u_parallaxX"),u=e.getUniformLocation(t,"u_parallaxY"),h=e.getUniformLocation(t,"u_glitchSeed"),ee=e.getUniformLocation(t,"u_scale"),te=e.getUniformLocation(t,"u_image"),oe=e.getUniformLocation(t,"u_glyphs"),W=e.createTexture(),g=e.createTexture();function q(l,_){e.activeTexture(e.TEXTURE0+_),e.bindTexture(e.TEXTURE_2D,l),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST)}q(W,0),q(g,1),e.uniform1i(te,0),e.uniform1i(oe,1);function O(){const l=m.getBoundingClientRect(),_=window.devicePixelRatio||1;c=l.width,x=l.height,m.width=c*_,m.height=x*_,e.viewport(0,0,m.width,m.height);const E=new OffscreenCanvas(100,100).getContext("2d");E.font=`${A}px ${B}`,p=E.measureText("0").width,T=A,y=Math.ceil(c/p),r=Math.ceil(x/T),k()}function k(){const l=Math.ceil(p),_=T+2,d=new OffscreenCanvas(l*w.length,_),E=d.getContext("2d");E.font=`${A}px ${B}`,E.textBaseline="top",E.fillStyle="#fff";for(let F=0;F<w.length;F++)E.fillText(w[F],F*l,1);e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,g),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,d)}const v=new Image;v.crossOrigin="anonymous",v.src=j,v.onload=()=>{e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,W),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,v),D=!0,O(),Y()},v.complete&&v.naturalWidth&&v.onload(new Event("load"));function Y(){if(!D){n=requestAnimationFrame(Y);return}C+=(I-C)*.05,M+=(L-M)*.05,f+=1/60,f>N&&(b=Math.random()*1e3,N=f+.2+Math.random()*.6,setTimeout(()=>{b=-1},50+Math.random()*100)),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.uniform2f(Q,c,x),e.uniform2f(Z,p,T),e.uniform2f(G,y,r),e.uniform1f($,w.length),e.uniform1f(a,J),e.uniform1f(i,V),e.uniform1f(o,f),e.uniform1f(R,C*P),e.uniform1f(u,M*P),e.uniform1f(h,b),e.uniform1f(ee,H),e.drawArrays(e.TRIANGLE_STRIP,0,4),n=requestAnimationFrame(Y)}return window.addEventListener("resize",O),()=>{cancelAnimationFrame(n),document.removeEventListener("mousemove",U),window.removeEventListener("resize",O)}}function se(S){const{canvas:m,imageSrc:j,chars:w=" 0123456789",fontSize:A=9,fontFamily:B='"DM Mono", monospace',brightnessBoost:J=2.2,posterize:V=32,parallaxStrength:P=8,scale:H=1.15,colorFn:K}=S,c=m.getContext("2d");let x=0,p=0,T=0,y=0,r=0,n=0,f=null,C=0,M=0,I=0,L=0,N=0,b=0,D,U=new Map,e=0,z=0;const t=a=>{N=(a.clientX/window.innerWidth-.5)*2,b=(a.clientY/window.innerHeight-.5)*2};document.addEventListener("mousemove",t,{passive:!0});const s=new Image;s.crossOrigin="anonymous",s.src=j;function X(){const a=m.getBoundingClientRect(),i=window.devicePixelRatio||1;x=a.width,p=a.height,m.width=x*i,m.height=p*i,c.setTransform(i,0,0,i,0,0),c.font=`${A}px ${B}`,T=c.measureText("0").width,y=A,r=Math.ceil(x/T),n=Math.ceil(p/y),D=new Float32Array(r*n);for(let o=0;o<r*n;o++)D[o]=Math.random();Q()}function Q(){if(!s.complete||!s.naturalWidth)return;const a=document.createElement("canvas");a.width=r,a.height=n;const i=a.getContext("2d"),o=r*H,R=n*H;i.drawImage(s,0,0,s.naturalWidth,s.naturalHeight,(r-o)/2,(n-R)/2,o,R),f=i.getImageData(0,0,r,n).data,C=r}function Z(a){if(a>e){U.clear();for(let i=0;i<1+Math.floor(Math.random()*3);i++){const o=Math.floor(Math.random()*n),R=1+Math.floor(Math.random()*3),u=(Math.random()-.5)*T*6;for(let h=o;h<Math.min(n,o+R);h++)U.set(h,u)}e=a+.2+Math.random()*.6,setTimeout(()=>U.clear(),50+Math.random()*100)}}function G(){if(!f){z=requestAnimationFrame(G);return}I+=(N-I)*.05,L+=(b-L)*.05,c.clearRect(0,0,x,p),c.font=`${A}px ${B}`,c.textBaseline="top",M+=1/60,Z(M);const a=r/2,i=n/2;for(let o=0;o<n;o++){const R=U.get(o)||0;for(let u=0;u<r;u++){const h=(o*C+u)*4,ee=f[h],te=f[h+1],oe=f[h+2],W=f[h+3];if(W<10)continue;let g=(ee*.299+te*.587+oe*.114)/255;if(g=Math.min(1,g*J*(W/255)),g=Math.round(g*V)/V,g<.03)continue;const q=Math.min(u/r,1-u/r),O=o*r+u,k=q+D[O]*.15,v=M/2*.6;if(k>v)continue;const Y=Math.min(1,(v-k)*6),l=u*T+I*P+R,_=o*y+L*P*.6,d=Math.min(w.length-1,Math.floor(g*(w.length-1))),E=g*Y,F=Math.sqrt(Math.pow((u-a)/a,2)+Math.pow((o-i)/i,2)),re=Math.max(.3,1-F*.5),ne=E*re;c.fillStyle=K(ne,F),c.fillText(w[d],l,_)}}z=requestAnimationFrame(G)}function $(){X(),G()}return s.onload=$,s.complete&&s.naturalWidth&&$(),window.addEventListener("resize",X),()=>{cancelAnimationFrame(z),document.removeEventListener("mousemove",t),window.removeEventListener("resize",X)}}function ae(){const S=document.getElementById("ascii-canvas");S&&ce({canvas:S,imageSrc:"/images/ascii-source.png"})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",ae):ae();
