// Geometry Dash-style auto-runner levels for cellular respiration
// Player auto-runs right. SPACE to jump (hold for repeated jumps when landing).
// Touching spikes / hitting block sides = DEATH (restart from beginning).
// Land on top of blocks. Yellow orbs = mid-air jump on SPACE press.
// Flip portals reverse gravity (player rolls along ceiling).

const W = 1280;
const H = 720;
const GROUND_Y = 600;        // top of floor
const CEILING_Y = 100;       // bottom of ceiling
const PLAYER_X = 280;        // fixed screen X for player
const PLAYER_SIZE = 40;
const TILE = 40;

// ---------- Drawing helpers ----------

function drawGDPlayer(ctx, x, y, form, rotation, t) {
  ctx.save();
  ctx.translate(x, y + PLAYER_SIZE / 2);
  ctx.rotate(rotation);

  const palette = {
    // Glucose is WHITE in real life (like table sugar). Subtle gray edge for visibility.
    glucose:  { fill: '#ffffff', edge: '#666666', glow: '#ffffff', label: 'C₆' },
    pyruvate: { fill: '#ff9a9a', edge: '#b83232', glow: '#ff7a7a', label: 'C₃' },
    acetyl:   { fill: '#b6ff7a', edge: '#2da017', glow: '#7aff7a', label: 'C₂' },
    electron: { fill: '#7ec8ff', edge: '#1e6fb8', glow: '#7ec8ff', label: 'e⁻' }
  }[form] || { fill: '#fff', edge: '#888', glow: '#fff', label: '?' };

  // Glow
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 24;

  // Cube body
  ctx.fillStyle = palette.fill;
  ctx.fillRect(-PLAYER_SIZE/2, -PLAYER_SIZE/2, PLAYER_SIZE, PLAYER_SIZE);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 3;
  ctx.strokeRect(-PLAYER_SIZE/2, -PLAYER_SIZE/2, PLAYER_SIZE, PLAYER_SIZE);

  // Inner highlight
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-PLAYER_SIZE/2 + 4, -PLAYER_SIZE/2 + 4, PLAYER_SIZE - 8, 8);

  // Label
  ctx.fillStyle = palette.edge;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(palette.label, 0, 2);

  ctx.restore();
}

function drawSpike(ctx, x, yBase, gravity = 1, color = '#ff5555') {
  // x = left edge in screen coords, yBase = ground line for spike base
  const w = TILE;
  const h = TILE;
  const dir = gravity > 0 ? -1 : 1; // point up when gravity normal
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(x, yBase);
  ctx.lineTo(x + w, yBase);
  ctx.lineTo(x + w/2, yBase + dir * h);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBlock(ctx, x, y, w, h, color = '#888') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  // Inner highlight
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x + 3, y + 3, w - 6, 6);
}

function drawOrb(ctx, x, y, t, used) {
  if (used) return;
  const r = 18;
  const pulse = 1 + Math.sin(t * 0.006) * 0.12;
  ctx.shadowColor = '#ffe27a';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,226,122,${0.4 + Math.sin(t*0.01)*0.3})`;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawPad(ctx, x, y, w) {
  ctx.fillStyle = '#ffaa33';
  ctx.shadowColor = '#ffaa33';
  ctx.shadowBlur = 14;
  ctx.fillRect(x, y - 8, w, 8);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y - 8, w, 8);
}

function drawFlipPortal(ctx, x, y, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = '#a07aff';
  ctx.shadowBlur = 24;
  ctx.fillStyle = `rgba(160,122,255,${0.35 + Math.sin(t*0.008)*0.15})`;
  ctx.fillRect(-15, -60, 30, 120);
  ctx.strokeStyle = '#c8a8ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(-15, -60, 30, 120);
  // Up & down arrows
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⇅', 0, 5);
  ctx.restore();
}

function drawEndMarker(ctx, x, t) {
  ctx.save();
  ctx.translate(x, GROUND_Y - 100);
  // Pulsing checkerboard flag
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 6, 100);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#fff' : '#000';
      ctx.fillRect(6 + j * 12, i * 16, 12, 16);
    }
  }
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12 + Math.sin(t * 0.01) * 8;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 54, 96);
  ctx.restore();
}

function drawParallax(ctx, t, colors, scrollX) {
  for (let layer = 0; layer < 3; layer++) {
    const speed = (layer + 1) * 0.25;
    const size = 100 + layer * 50;
    const alpha = 0.05 + layer * 0.04;
    ctx.fillStyle = `rgba(${colors[layer]}, ${alpha})`;
    for (let i = 0; i < 10; i++) {
      const x = (((i * 260) - scrollX * speed) % (W + 400)) - 200;
      const y = 150 + layer * 100 + Math.sin(i + t * 0.0008) * 40;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ===================================================================
// BIO OVERLAY: large molecule + reaction drawings for level backgrounds
// ===================================================================

function bioGlucose(ctx, x, y, scale = 1, alpha = 0.55, showLabel = true) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = 32 * scale;
  // Glucose is WHITE in reality (crystalline sugar). Subtle gray glow + edge for visibility.
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 24 * scale;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 3 * scale;
  ctx.stroke();
  // Carbon dots — dark gray on white so the labels read
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${10 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  if (showLabel) {
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.fillText('Glucose', x, y - r - 14 * scale);
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillText('C₆H₁₂O₆', x, y - r - 2 * scale);
  }
  ctx.restore();
}

function bioPyruvate(ctx, x, y, scale = 1, alpha = 0.6, label = '') {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = '#ff9a9a';
  ctx.shadowBlur = 16 * scale;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#ff9a9a';
    ctx.beginPath();
    ctx.arc(x + (i - 1) * 22 * scale, y, 14 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#b83232';
  ctx.lineWidth = 2 * scale;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x + (i - 1) * 22 * scale, y, 14 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${10 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) ctx.fillText('C', x + (i - 1) * 22 * scale, y);
  if (label) {
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.fillText(label, x, y - 28 * scale);
  }
  ctx.restore();
}

function bioAcetylCoA(ctx, x, y, scale = 1, alpha = 0.6) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = '#b6ff7a';
  ctx.shadowBlur = 14 * scale;
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = '#b6ff7a';
    ctx.beginPath();
    ctx.arc(x + (i - 0.5) * 20 * scale, y, 13 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  // CoA tail
  ctx.strokeStyle = '#7ec8ff';
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(x + 14 * scale, y);
  ctx.lineTo(x + 38 * scale, y - 8 * scale);
  ctx.lineTo(x + 52 * scale, y + 4 * scale);
  ctx.stroke();
  ctx.fillStyle = '#7ec8ff';
  ctx.beginPath();
  ctx.arc(x + 52 * scale, y + 4 * scale, 8 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${9 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CoA', x + 52 * scale, y + 4 * scale);
  ctx.font = `bold ${13 * scale}px sans-serif`;
  ctx.fillText('Acetyl-CoA', x, y - 28 * scale);
  ctx.restore();
}

function bioATP(ctx, x, y, scale = 1, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = '#ffe27a';
  ctx.shadowBlur = 14 * scale;
  // 3 phosphate circles
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.arc(x + (i - 1) * 14 * scale, y, 9 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#5a3a00';
  ctx.font = `bold ${9 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) ctx.fillText('P', x + (i - 1) * 14 * scale, y);
  ctx.fillStyle = '#ffe27a';
  ctx.font = `bold ${11 * scale}px sans-serif`;
  ctx.fillText('ATP', x, y + 18 * scale);
  ctx.restore();
}

function bioNADH(ctx, x, y, scale = 1, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = '#7ec8ff';
  ctx.shadowBlur = 14 * scale;
  ctx.fillStyle = '#7ec8ff';
  ctx.beginPath();
  ctx.arc(x, y, 14 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${10 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NADH', x, y);
  ctx.restore();
}

function bioFADH2(ctx, x, y, scale = 1, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = '#ff9a9a';
  ctx.shadowBlur = 14 * scale;
  ctx.fillStyle = '#ff9a9a';
  ctx.beginPath();
  ctx.arc(x, y, 14 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${9 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FADH₂', x, y);
  ctx.restore();
}

function bioCO2(ctx, x, y, scale = 1, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#aaa';
  ctx.shadowColor = '#888';
  ctx.shadowBlur = 8 * scale;
  ctx.beginPath();
  ctx.arc(x, y, 13 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  ctx.font = `bold ${10 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CO₂', x, y);
  ctx.restore();
}

function bioOxygen(ctx, x, y, scale = 1, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#90e0ff';
  ctx.shadowColor = '#90e0ff';
  ctx.shadowBlur = 14 * scale;
  ctx.beginPath();
  ctx.arc(x, y, 14 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#003355';
  ctx.font = `bold ${10 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('O₂', x, y);
  ctx.restore();
}

function bioH2O(ctx, x, y, scale = 1, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#5fa8e8';
  ctx.shadowColor = '#5fa8e8';
  ctx.shadowBlur = 10 * scale;
  ctx.beginPath();
  ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${10 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H₂O', x, y);
  ctx.restore();
}

function bioArrow(ctx, x1, y1, x2, y2, color = '#fff', alpha = 0.7) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Arrowhead
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ah = 10;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ah * Math.cos(angle - 0.4), y2 - ah * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - ah * Math.cos(angle + 0.4), y2 - ah * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function bioLabel(ctx, x, y, text, size = 14, color = '#fff', alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Draw player decorations (phosphate orbs around glucose, etc.)
function drawPlayerDecorations(ctx, x, y, state) {
  // Phosphate orbs orbiting the player (for Level 1 glycolysis investment)
  const phos = state.playerPhosphates || 0;
  for (let i = 0; i < phos; i++) {
    const angle = (i / phos) * Math.PI * 2 + state.elapsed * 0.004;
    const ox = x + PLAYER_SIZE / 2 + Math.cos(angle) * 36;
    const oy = y + PLAYER_SIZE / 2 + Math.sin(angle) * 36;
    ctx.save();
    ctx.shadowColor = '#ffe27a';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.arc(ox, oy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#5a3a00';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', ox, oy);
    ctx.restore();
  }
  // After glucose split: show "2× C3" indicator
  if (state.playerSplit) {
    ctx.save();
    ctx.fillStyle = '#ff9a9a';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.fillText('2× C₃', x + PLAYER_SIZE/2, y - 18);
    ctx.restore();
  }
}

// ---------- Obstacle bounding boxes ----------

function obstacleBox(ob) {
  if (ob.type === 'spike') {
    // Hitbox slightly smaller than visual triangle for fairness
    if (ob.gravity === -1) {
      // ceiling spike — pointing down from CEILING_Y
      return { x: ob.x + 8, y: CEILING_Y, w: TILE - 16, h: TILE - 8 };
    }
    return { x: ob.x + 8, y: GROUND_Y - TILE + 8, w: TILE - 16, h: TILE - 8 };
  }
  if (ob.type === 'block') {
    return { x: ob.x, y: ob.y, w: ob.w, h: ob.h };
  }
  if (ob.type === 'orb') {
    return { x: ob.x - 22, y: ob.y - 22, w: 44, h: 44 };
  }
  if (ob.type === 'pad') {
    return { x: ob.x, y: ob.y - 14, w: ob.w, h: 14 };
  }
  if (ob.type === 'flip') {
    return { x: ob.x - 15, y: ob.y - 60, w: 30, h: 120 };
  }
  if (ob.type === 'end') {
    return { x: ob.x, y: 0, w: 30, h: H };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

// ---------- Level definitions ----------

function makeLevel(config) {
  return {
    name: config.name,
    location: config.location,
    description: config.description,
    form: config.form,
    palette: config.palette,
    speed: config.speed,
    length: config.length,
    obstacles: config.obstacles,
    bioStages: config.bioStages || [],
    drawAlways: config.drawAlways || null,

    init(state) {
      state.player.form = config.form;
      state.player.x = PLAYER_X;
      state.player.y = GROUND_Y - PLAYER_SIZE;
      state.player.vy = 0;
      state.player.gravity = 1;
      state.player.onGround = true;
      state.player.rotation = 0;
      state.scrollX = 0;
      state.elapsed = 0;
      state.dead = false;
      state.completed = false;
      state.particles = [];
      state.trail = [];
      state.flashTimer = 0;
      state.flashText = '';
      // Bio overlay state
      state.passedStages = [];
      state.activeBioFlashes = [];
      state.playerPhosphates = 0;
      state.playerSplit = false;
      // Deep-clone obstacles each attempt so used/activated flags reset
      state.obstacles = config.obstacles.map(o => ({ ...o, used: false, activated: false }));
    },

    update(dt, input, state) {
      if (state.dead || state.completed) return;
      state.elapsed += dt;

      const dtf = dt / 16.67; // normalized to 60fps frames

      // Scroll world
      state.scrollX += config.speed * dtf;

      const p = state.player;

      // Player physics — lower gravity, higher jump = more hang time, more forgiving
      p.vy += 0.78 * p.gravity * dtf;
      p.y += p.vy * dtf;

      // Auto-jump: holding SPACE while on ground = jump again on landing
      const jumpReq = input.jumpHeld || input.jumpPressed;

      // Player rectangle in world coords
      const playerWorldX = state.scrollX + PLAYER_X;
      const playerBox = { x: playerWorldX - PLAYER_SIZE/2, y: p.y, w: PLAYER_SIZE, h: PLAYER_SIZE };
      const prevY = p.y - p.vy * dtf;
      const prevBox = { x: playerWorldX - PLAYER_SIZE/2, y: prevY, w: PLAYER_SIZE, h: PLAYER_SIZE };

      p.onGround = false;

      // Default floor/ceiling
      if (p.gravity > 0) {
        if (p.y + PLAYER_SIZE >= GROUND_Y) {
          p.y = GROUND_Y - PLAYER_SIZE;
          p.vy = 0;
          p.onGround = true;
        }
      } else {
        if (p.y <= CEILING_Y) {
          p.y = CEILING_Y;
          p.vy = 0;
          p.onGround = true;
        }
      }

      // Collisions
      for (const ob of state.obstacles) {
        const box = obstacleBox(ob);
        // Cull far obstacles
        if (box.x + box.w < playerWorldX - W) continue;
        if (box.x > playerWorldX + W) continue;

        if (!aabb(playerBox, box)) continue;

        if (ob.type === 'spike') {
          this.die(state);
          return;
        } else if (ob.type === 'block') {
          // Landing tolerance: half the block height (handles fast descents fairly)
          const playerBottom = playerBox.y + PLAYER_SIZE;
          const prevBottom = prevBox.y + PLAYER_SIZE;
          const tol = Math.max(20, box.h * 0.5);
          if (p.gravity > 0 && p.vy >= 0 && prevBottom <= box.y + tol) {
            // Descending onto block top — land
            p.y = box.y - PLAYER_SIZE;
            p.vy = 0;
            p.onGround = true;
          } else if (p.gravity < 0 && p.vy <= 0 && prevBox.y >= box.y + box.h - tol) {
            // Flipped gravity equivalent
            p.y = box.y + box.h;
            p.vy = 0;
            p.onGround = true;
          } else {
            this.die(state);
            return;
          }
        } else if (ob.type === 'orb' && !ob.used) {
          if (input.jumpPressed) {
            p.vy = -16 * p.gravity;
            ob.used = true;
            state.flashText = "PHOSPHORYLATED!";
            state.flashTimer = 700;
            state.sfx && state.sfx('collect');
          }
        } else if (ob.type === 'pad' && !ob.used) {
          p.vy = -22 * p.gravity;
          ob.used = true;
          state.sfx && state.sfx('jump');
        } else if (ob.type === 'flip' && !ob.used) {
          p.gravity *= -1;
          p.vy = 0;
          ob.used = true;
          state.flashText = "GRAVITY FLIPPED!";
          state.flashTimer = 1100;
          state.sfx && state.sfx('beat');
        } else if (ob.type === 'end') {
          state.completed = true;
          state.completeLevelFromEnd && state.completeLevelFromEnd();
          return;
        }
      }

      // Bio stage triggers — player passes a checkpoint, trigger label + effect
      for (const stage of this.bioStages) {
        if (state.passedStages.includes(stage.id)) continue;
        if (playerWorldX >= stage.x) {
          state.passedStages.push(stage.id);
          if (stage.effect === 'phosphate') state.playerPhosphates += 1;
          if (stage.effect === 'split') state.playerSplit = true;
          state.activeBioFlashes.push({
            text: stage.label,
            life: 3200,
            maxLife: 3200,
            color: stage.color || '#ffe27a'
          });
          state.sfx && state.sfx('collect');
        }
      }
      for (const f of state.activeBioFlashes) f.life -= dt;
      state.activeBioFlashes = state.activeBioFlashes.filter(f => f.life > 0);

      // Rotation
      if (!p.onGround) {
        p.rotation += 0.18 * p.gravity * dtf;
      } else {
        // Snap to nearest quarter turn
        const target = Math.round(p.rotation / (Math.PI/2)) * (Math.PI/2);
        p.rotation += (target - p.rotation) * 0.25;
      }

      // Jump — higher impulse, more clearance
      if (jumpReq && p.onGround) {
        p.vy = -16 * p.gravity;
        p.onGround = false;
        state.sfx && state.sfx('jump');
      }

      // Trail
      state.trail.push({ x: playerWorldX, y: p.y + PLAYER_SIZE/2, life: 500 });
      for (const t of state.trail) t.life -= dt;
      state.trail = state.trail.filter(t => t.life > 0);

      // End by length too (safety)
      if (state.scrollX > config.length + 200 && !state.completed) {
        state.completed = true;
        state.completeLevelFromEnd && state.completeLevelFromEnd();
      }

      if (state.flashTimer > 0) state.flashTimer -= dt;
    },

    die(state) {
      state.dead = true;
      state.attempts = (state.attempts || 1);
      // Particle explosion
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        state.particles.push({
          x: PLAYER_X,
          y: state.player.y + PLAYER_SIZE/2,
          vx: Math.cos(a) * (3 + Math.random() * 4),
          vy: Math.sin(a) * (3 + Math.random() * 4),
          life: 800,
          maxLife: 800,
          color: ['#ffe27a', '#ff9a9a', '#7ec8ff', '#b6ff7a'][Math.floor(Math.random()*4)]
        });
      }
      state.sfx && state.sfx('wrong');
      // Trigger restart after a short delay (game.js handles)
      state.onDeath && state.onDeath();
    },

    render(ctx, state) {
      // Background
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, config.palette.bgTop);
      grad.addColorStop(1, config.palette.bgBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      drawParallax(ctx, state.elapsed, config.palette.parallax, state.scrollX);

      // Persistent biology background (Krebs wheel, ETC complexes, etc.)
      if (this.drawAlways) this.drawAlways(ctx, state);

      // Per-stage biology illustrations at world positions
      for (const stage of this.bioStages) {
        const sx = stage.x - state.scrollX;
        if (sx < -400 || sx > W + 400) continue;
        if (stage.draw) stage.draw(ctx, sx, state);
      }

      // Ground
      ctx.fillStyle = config.palette.ground;
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      // Ceiling
      ctx.fillStyle = config.palette.ceiling || config.palette.ground;
      ctx.fillRect(0, 0, W, CEILING_Y);

      // Floor accent line
      ctx.strokeStyle = config.palette.accent;
      ctx.lineWidth = 4;
      ctx.shadowColor = config.palette.accent;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(W, GROUND_Y);
      ctx.moveTo(0, CEILING_Y);
      ctx.lineTo(W, CEILING_Y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Grid lines on ground
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const gridOffset = state.scrollX % TILE;
      for (let i = 0; i < W / TILE + 2; i++) {
        const gx = i * TILE - gridOffset;
        ctx.beginPath();
        ctx.moveTo(gx, GROUND_Y);
        ctx.lineTo(gx, H);
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, CEILING_Y);
        ctx.stroke();
      }
      for (let j = 0; j < (H - GROUND_Y) / TILE; j++) {
        ctx.beginPath();
        ctx.moveTo(0, GROUND_Y + j * TILE);
        ctx.lineTo(W, GROUND_Y + j * TILE);
        ctx.stroke();
      }

      // Trail
      for (const t of state.trail) {
        const sx = t.x - state.scrollX;
        if (sx < -50 || sx > W + 50) continue;
        const alpha = t.life / 500;
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.45})`;
        ctx.beginPath();
        ctx.arc(sx, t.y, 6 * alpha + 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Obstacles
      for (const ob of state.obstacles) {
        const sx = ob.x - state.scrollX;
        if (sx < -200 || sx > W + 200) continue;

        if (ob.type === 'spike') {
          const yBase = ob.gravity === -1 ? CEILING_Y : GROUND_Y;
          drawSpike(ctx, sx, yBase, ob.gravity === -1 ? -1 : 1, config.palette.danger);
        } else if (ob.type === 'block') {
          drawBlock(ctx, sx, ob.y, ob.w, ob.h, config.palette.block);
        } else if (ob.type === 'orb') {
          drawOrb(ctx, sx, ob.y, state.elapsed, ob.used);
        } else if (ob.type === 'pad') {
          drawPad(ctx, sx, ob.y, ob.w);
        } else if (ob.type === 'flip') {
          drawFlipPortal(ctx, sx, ob.y, state.elapsed);
        } else if (ob.type === 'end') {
          drawEndMarker(ctx, sx, state.elapsed);
        }
      }

      // Player (or particles if dead)
      if (!state.dead) {
        drawGDPlayer(ctx, PLAYER_X, state.player.y, state.player.form, state.player.rotation, state.elapsed);
        drawPlayerDecorations(ctx, PLAYER_X - PLAYER_SIZE/2, state.player.y, state);
      } else {
        for (const p of state.particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.3;
          p.life -= 16;
          const a = Math.max(0, p.life / p.maxLife);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = a;
          ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
          ctx.globalAlpha = 1;
        }
      }

      // Progress bar
      const prog = Math.min(1, state.scrollX / config.length);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W/2 - 220, 32, 440, 14);
      ctx.fillStyle = config.palette.accent;
      ctx.fillRect(W/2 - 220, 32, 440 * prog, 14);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(W/2 - 220, 32, 440, 14);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.floor(prog * 100)}%`, W/2, 60);

      // Attempt counter
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`Attempt ${state.attempts || 1}`, W - 30, 65);

      // Bio stage flash labels (stacked, fade out)
      let bioY = 110;
      for (const f of state.activeBioFlashes || []) {
        const fadeIn = Math.min(1, (f.maxLife - f.life) / 200);
        const fadeOut = Math.min(1, f.life / 700);
        const a = Math.min(fadeIn, fadeOut);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const padX = 16, padY = 6;
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(f.text).width + padX * 2;
        ctx.fillRect(W/2 - tw/2, bioY - 14, tw, 28);
        ctx.strokeStyle = f.color || '#ffe27a';
        ctx.lineWidth = 2;
        ctx.strokeRect(W/2 - tw/2, bioY - 14, tw, 28);
        ctx.fillStyle = f.color || '#ffe27a';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, W/2, bioY);
        ctx.restore();
        bioY += 36;
      }

      // Flash text
      if (state.flashTimer > 0 && state.flashText) {
        ctx.fillStyle = `rgba(255,226,122,${Math.min(1, state.flashTimer/700)})`;
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 14;
        ctx.fillText(state.flashText, W/2, 160);
        ctx.shadowBlur = 0;
      }
    }
  };
}

// ============================================================
// HAND-CRAFTED LEVELS
// ============================================================

// Helper to build obstacle lists with x in tiles for readability
function obs(list) {
  // list is array of [type, xTile, ...args]
  return list.map(([type, xt, ...args]) => {
    const x = xt * TILE;
    if (type === 'spike') {
      const grav = args[0] || 1;
      return { type, x, gravity: grav };
    }
    if (type === 'block') {
      const [yTilesFromGround, wTiles, hTiles] = args;
      return {
        type, x,
        y: GROUND_Y - yTilesFromGround * TILE - hTiles * TILE,
        w: wTiles * TILE,
        h: hTiles * TILE
      };
    }
    if (type === 'orb') {
      return { type, x, y: GROUND_Y - args[0] * TILE };
    }
    if (type === 'pad') {
      return { type, x, y: GROUND_Y, w: args[0] * TILE || TILE };
    }
    if (type === 'flip') {
      return { type, x, y: GROUND_Y - 3 * TILE };
    }
    if (type === 'end') {
      return { type, x };
    }
  });
}

// ----- LEVEL 1: GLYCOLYSIS (easy — generous spacing, simple obstacles) -----
const Level1 = makeLevel({
  name: "Glycolysis",
  location: "CYTOPLASM",
  description: "You are a glucose molecule rolling through the cytoplasm. Avoid denatured enzymes (spikes). Hold SPACE to keep jumping. Reach the end of the level to advance.",
  form: 'glucose',
  speed: 5.5,
  length: 10500,
  // Pale pink — accurate textbook cytoplasm color (light, translucent, slightly pink from cell organelle staining)
  palette: {
    bgTop: '#fadbd8',
    bgBottom: '#e8b8b0',
    ground: '#c08070',
    ceiling: '#b07060',
    accent: '#7a2828',
    block: '#5a2a20',
    danger: '#a02020',
    parallax: ['210,170,160', '180,140,130', '140,100,90']
  },
  obstacles: obs([
    ['spike', 16],
    ['spike', 22],
    ['spike', 27], ['spike', 28],
    ['block', 34, 0, 1, 1],
    ['spike', 39],
    ['spike', 44], ['spike', 45],
    ['block', 52, 0, 2, 1],
    ['spike', 59],
    ['spike', 64], ['spike', 65],
    ['spike', 71],
    ['pad', 78, 1],
    ['spike', 87],
    ['spike', 92], ['spike', 93],
    ['block', 100, 0, 1, 2],
    ['spike', 108],
    ['orb', 113, 4],
    ['spike', 120],
    ['spike', 125], ['spike', 126],
    ['block', 133, 0, 2, 1],
    ['spike', 140],
    ['spike', 145], ['spike', 146],
    ['spike', 152],
    ['block', 159, 0, 1, 1],
    ['spike', 165],
    ['spike', 170], ['spike', 171],
    ['orb', 178, 4],
    ['spike', 185],
    ['spike', 190], ['spike', 191], ['spike', 192],
    ['block', 200, 0, 1, 1],
    ['spike', 206],
    ['spike', 211], ['spike', 212],
    ['block', 219, 0, 2, 1],
    ['spike', 226],
    ['orb', 232, 4],
    ['spike', 239],
    ['spike', 244], ['spike', 245],
    ['spike', 251],
    ['end', 261]
  ]),
  bioStages: [
    {
      id: 'g-enter',
      x: 400,
      label: '🍯 GLUCOSE enters the cytoplasm (C₆H₁₂O₆ — 6 carbons)',
      color: '#ffe27a',
      draw: (ctx, sx) => {
        bioGlucose(ctx, sx, 200, 1.6, 0.55);
        bioLabel(ctx, sx, 290, '6 carbons, lots of stored energy', 13, '#ffe27a', 0.85);
      }
    },
    {
      id: 'g-step1',
      x: 1300,
      label: 'STEP 1: Hexokinase phosphorylates glucose (–1 ATP)',
      color: '#ffe27a',
      effect: 'phosphate',
      draw: (ctx, sx) => {
        bioGlucose(ctx, sx - 80, 200, 1.0, 0.5, false);
        bioATP(ctx, sx + 20, 240, 0.85, 0.7);
        bioArrow(ctx, sx + 20, 200, sx - 30, 200, '#ff6688', 0.7);
        bioLabel(ctx, sx - 80, 270, 'ATP → ADP + P', 12, '#ffe27a', 0.75);
        bioLabel(ctx, sx, 165, '⚡ glucose now activated', 11, '#fff', 0.7);
      }
    },
    {
      id: 'g-step3',
      x: 2400,
      label: 'STEP 3: Phosphofructokinase adds 2nd phosphate (–1 ATP). 2 ATP invested!',
      color: '#ffe27a',
      effect: 'phosphate',
      draw: (ctx, sx) => {
        bioGlucose(ctx, sx - 80, 200, 1.0, 0.5, false);
        bioATP(ctx, sx + 20, 240, 0.85, 0.7);
        bioArrow(ctx, sx + 20, 200, sx - 30, 200, '#ff6688', 0.7);
        bioLabel(ctx, sx - 80, 270, '2 ATP total spent', 12, '#ffe27a', 0.75);
      }
    },
    {
      id: 'g-split',
      x: 3700,
      label: '✂️ STEP 4: SPLIT! Fructose-1,6-bisphosphate → 2× G3P (3 carbons each)',
      color: '#ff9a9a',
      effect: 'split',
      draw: (ctx, sx, state) => {
        // Dramatic split — glucose breaks into 2 pyruvate-like halves
        const t = Math.min(1, state.activeBioFlashes.find(f => f.text.includes('SPLIT'))?.life > 0
          ? (3200 - state.activeBioFlashes.find(f => f.text.includes('SPLIT')).life) / 800 : 1);
        const off = 60 * t;
        bioPyruvate(ctx, sx - off - 30, 200, 0.85, 0.6, '');
        bioPyruvate(ctx, sx + off + 30, 200, 0.85, 0.6, '');
        // Crack line
        ctx.save();
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(sx, 160);
        ctx.lineTo(sx + 10, 195);
        ctx.lineTo(sx - 10, 215);
        ctx.lineTo(sx + 5, 240);
        ctx.stroke();
        ctx.restore();
        bioLabel(ctx, sx, 270, '6C → 3C + 3C', 13, '#ff9a9a', 0.85);
      }
    },
    {
      id: 'g-nadh',
      x: 4700,
      label: 'STEP 6: G3P oxidized → +2 NADH (per glucose)',
      color: '#7ec8ff',
      draw: (ctx, sx) => {
        bioPyruvate(ctx, sx - 70, 200, 0.8, 0.5, '');
        bioArrow(ctx, sx - 30, 200, sx + 20, 200, '#7ec8ff', 0.7);
        bioNADH(ctx, sx + 60, 200, 1.0, 0.85);
        bioNADH(ctx, sx + 100, 200, 1.0, 0.85);
        bioLabel(ctx, sx + 40, 240, '+ 2 NADH', 13, '#7ec8ff', 0.85);
      }
    },
    {
      id: 'g-atp1',
      x: 5800,
      label: 'STEPS 7-10: Substrate-level phosphorylation → +4 ATP produced',
      color: '#ffe27a',
      draw: (ctx, sx) => {
        bioATP(ctx, sx - 30, 200, 0.9, 0.85);
        bioATP(ctx, sx, 200, 0.9, 0.85);
        bioATP(ctx, sx + 30, 200, 0.9, 0.85);
        bioATP(ctx, sx + 60, 200, 0.9, 0.85);
        bioLabel(ctx, sx + 10, 245, '+ 4 ATP (gross)', 13, '#ffe27a', 0.85);
        bioLabel(ctx, sx + 10, 265, '−2 invested = NET +2 ATP', 12, '#fff', 0.7);
      }
    },
    {
      id: 'g-result',
      x: 7200,
      label: '✅ GLYCOLYSIS COMPLETE: 1 glucose → 2 pyruvate + 2 ATP (net) + 2 NADH',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioPyruvate(ctx, sx - 60, 200, 1.0, 0.7, 'Pyruvate');
        bioPyruvate(ctx, sx + 60, 200, 1.0, 0.7, 'Pyruvate');
        bioLabel(ctx, sx, 280, '→ headed to the mitochondria', 13, '#b6ff7a', 0.85);
      }
    }
  ]
});

// ----- LEVEL 2: PYRUVATE OXIDATION (medium — tighter spacing, more clusters) -----
const Level2 = makeLevel({
  name: "Pyruvate Oxidation",
  location: "MITOCHONDRIAL MEMBRANE",
  description: "Now a pyruvate, you must cross both mitochondrial membranes. Faster pace, tighter spike clusters, and your first triple spike!",
  form: 'pyruvate',
  speed: 6.3,
  length: 11500,
  palette: {
    bgTop: '#4a1018',
    bgBottom: '#1a0508',
    ground: '#6a1a28',
    ceiling: '#5a1020',
    accent: '#ff9a9a',
    block: '#a83040',
    danger: '#ffaa44',
    parallax: ['200,100,100', '160,70,80', '100,40,50']
  },
  obstacles: obs([
    // ── ENTERING THE MITOCHONDRION (crossing the outer + inner membranes) ──
    ['spike', 16],
    ['spike', 23],
    ['spike', 30], ['spike', 31],
    ['block', 39, 0, 1, 1],     // 1-tile block, jumpable from previous spike
    ['spike', 47],

    // ── PYRUVATE 1: DECARBOXYLATION (CO₂ release) ──
    ['spike', 54], ['spike', 55],
    ['orb', 62, 4],              // orb sets up next jump
    ['block', 68, 0, 1, 2],      // 2-tile block, orb just before enables landing
    ['spike', 78],
    ['spike', 85], ['spike', 86],

    // ── PYRUVATE 1: CoA BONDING + NADH ──
    ['spike', 93],
    ['pad', 100, 1],             // launch pad — gives big arc
    ['spike', 110], ['spike', 111], ['spike', 112],
    ['block', 120, 0, 1, 1],

    // ── PYRUVATE 2: REPEAT THE PROCESS ──
    ['spike', 128],
    ['spike', 134], ['spike', 135],
    ['orb', 142, 4],
    ['block', 148, 0, 1, 2],     // 2-tile block, orb prep
    ['spike', 158],
    ['spike', 165], ['spike', 166],

    // ── ELONGATION CHAIN OF ENZYMES ──
    ['spike', 173],
    ['spike', 178], ['spike', 179],
    ['spike', 185],
    ['block', 192, 0, 1, 1],
    ['spike', 200],
    ['orb', 207, 4],
    ['spike', 214], ['spike', 215],
    ['pad', 222, 1],

    // ── FORMING 2 ACETYL-CoA (final sequence) ──
    ['spike', 232], ['spike', 233], ['spike', 234],
    ['block', 242, 0, 1, 1],
    ['spike', 250],
    ['orb', 257, 4],
    ['spike', 264],
    ['spike', 270], ['spike', 271],
    ['spike', 278],
    ['end', 287]
  ]),
  bioStages: [
    {
      id: 'p-enter',
      x: 400,
      label: '2 PYRUVATE enter the mitochondrial matrix',
      color: '#ff9a9a',
      draw: (ctx, sx) => {
        bioPyruvate(ctx, sx - 50, 200, 0.95, 0.6, 'Pyruvate 1');
        bioPyruvate(ctx, sx + 70, 200, 0.95, 0.6, 'Pyruvate 2');
        bioLabel(ctx, sx + 10, 260, 'crossed both mitochondrial membranes', 12, '#fff', 0.7);
      }
    },
    {
      id: 'p-co2-1',
      x: 1800,
      label: '🌬️ Pyruvate 1 loses a CARBON as CO₂',
      color: '#aaa',
      draw: (ctx, sx, state) => {
        bioPyruvate(ctx, sx - 70, 200, 0.85, 0.5, '');
        bioArrow(ctx, sx - 30, 200, sx + 20, 200, '#aaa', 0.6);
        // CO2 rising
        const t = (state.elapsed * 0.001) % 1;
        bioCO2(ctx, sx + 60, 200 - t * 60, 0.9, 0.85 - t * 0.6);
        bioLabel(ctx, sx, 270, '3 carbons → 2 carbons', 12, '#fff', 0.75);
      }
    },
    {
      id: 'p-coa-1',
      x: 2700,
      label: '🔗 Acetyl group bonds with Coenzyme A → Acetyl-CoA',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioAcetylCoA(ctx, sx, 200, 1.0, 0.65);
        bioLabel(ctx, sx + 25, 260, '+ 1 NADH made', 12, '#7ec8ff', 0.85);
      }
    },
    {
      id: 'p-co2-2',
      x: 4500,
      label: '🌬️ Pyruvate 2 also loses a CO₂',
      color: '#aaa',
      draw: (ctx, sx, state) => {
        bioPyruvate(ctx, sx - 70, 200, 0.85, 0.5, '');
        bioArrow(ctx, sx - 30, 200, sx + 20, 200, '#aaa', 0.6);
        const t = (state.elapsed * 0.001 + 0.3) % 1;
        bioCO2(ctx, sx + 60, 200 - t * 60, 0.9, 0.85 - t * 0.6);
      }
    },
    {
      id: 'p-coa-2',
      x: 5500,
      label: '🔗 Pyruvate 2 bonds CoA → second Acetyl-CoA',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioAcetylCoA(ctx, sx, 200, 1.0, 0.65);
        bioLabel(ctx, sx + 25, 260, '+ 1 more NADH', 12, '#7ec8ff', 0.85);
      }
    },
    {
      id: 'p-result',
      x: 8200,
      label: '✅ TRANSITION COMPLETE: 2 Pyruvate → 2 Acetyl-CoA + 2 CO₂ + 2 NADH',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioAcetylCoA(ctx, sx - 70, 200, 0.95, 0.7);
        bioAcetylCoA(ctx, sx + 70, 200, 0.95, 0.7);
        bioLabel(ctx, sx, 285, '→ ready for the Krebs cycle', 13, '#b6ff7a', 0.85);
      }
    }
  ]
});

// ----- LEVEL 3: KREBS CYCLE (hard — tight clusters, tall blocks) -----
const Level3 = makeLevel({
  name: "Krebs Cycle",
  location: "MITOCHONDRIAL MATRIX",
  description: "You are Acetyl-CoA, cycling through the matrix. Faster, denser clusters, more triples, and tall blocks that demand precise orb timing.",
  form: 'acetyl',
  speed: 7.0,
  length: 13400,
  palette: {
    bgTop: '#5a1810',
    bgBottom: '#1a0510',
    ground: '#8a2a18',
    ceiling: '#8a2a18',
    accent: '#b6ff7a',
    block: '#cc6a40',
    danger: '#ffd060',
    parallax: ['200,110,80', '160,80,60', '100,50,30']
  },
  obstacles: obs([
    // ── ENTERING THE CYCLE: Acetyl-CoA + Oxaloacetate → Citrate ──
    ['spike', 14],
    ['spike', 21],
    ['spike', 28], ['spike', 29],
    ['block', 37, 0, 1, 1],
    ['spike', 45],

    // ── CITRATE → ISOCITRATE → α-KETOGLUTARATE (first CO₂ + NADH) ──
    ['spike', 52], ['spike', 53],
    ['orb', 60, 4],
    ['block', 66, 0, 1, 2],     // 2-tile block, orb prep
    ['spike', 76],
    ['spike', 83], ['spike', 84],

    // ── SUCCINYL-CoA → SUCCINATE (2nd CO₂ + ATP/GTP) ──
    ['spike', 91],
    ['pad', 98, 1],
    ['spike', 109], ['spike', 110], ['spike', 111],
    ['block', 119, 0, 1, 1],
    ['spike', 127],

    // ── SUCCINATE → FUMARATE (FADH₂ production) ──
    ['spike', 134], ['spike', 135],
    ['orb', 142, 4],
    ['block', 148, 0, 2, 2],     // wider 2-tall block, orb prep
    ['spike', 159],
    ['spike', 166], ['spike', 167],

    // ── MALATE → OXALOACETATE → REPEAT (2nd turn) ──
    ['spike', 174],
    ['spike', 180], ['spike', 181], ['spike', 182],
    ['orb', 190, 4],
    ['block', 196, 0, 1, 2],
    ['spike', 206],

    // ── SECOND TURN: ACCELERATED CYCLE ──
    ['spike', 213], ['spike', 214],
    ['pad', 222, 1],
    ['spike', 233], ['spike', 234], ['spike', 235],
    ['block', 243, 0, 1, 1],
    ['spike', 251],
    ['orb', 258, 4],
    ['block', 264, 0, 1, 2],
    ['spike', 274],
    ['spike', 280], ['spike', 281],

    // ── FINAL OUTPUT: 6 NADH + 2 FADH₂ + 2 ATP READY ──
    ['spike', 288],
    ['orb', 295, 4],
    ['spike', 302], ['spike', 303],
    ['spike', 310],
    ['block', 318, 0, 1, 1],
    ['spike', 325],
    ['end', 334]
  ]),
  drawAlways: (ctx, state) => {
    // Persistent Krebs cycle wheel in upper-left area, showing player progress around it
    const cx = 200, cy = 200, R = 90;
    const intermediates = [
      { name: 'Citrate',       co2: false, nadh: false, fadh2: false, atp: false },
      { name: 'Isocitrate',    co2: false, nadh: false, fadh2: false, atp: false },
      { name: 'α-Ketoglut.',   co2: true,  nadh: true,  fadh2: false, atp: false },
      { name: 'Succinyl-CoA',  co2: true,  nadh: true,  fadh2: false, atp: false },
      { name: 'Succinate',     co2: false, nadh: false, fadh2: false, atp: true },
      { name: 'Fumarate',      co2: false, nadh: false, fadh2: true,  atp: false },
      { name: 'Malate',        co2: false, nadh: false, fadh2: false, atp: false },
      { name: 'Oxaloacetate',  co2: false, nadh: true,  fadh2: false, atp: false }
    ];
    ctx.save();
    // Faded ring
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 36;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Cycle direction arrows
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a1 = (i / 8) * Math.PI * 2 - Math.PI / 2 + 0.12;
      const ax = cx + Math.cos(a1) * (R + 24);
      const ay = cy + Math.sin(a1) * (R + 24);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a1 + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, -3);
      ctx.lineTo(4, 3);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.restore();
    }

    // Intermediates
    intermediates.forEach((mol, i) => {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R;
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      // Label outside ring
      ctx.fillStyle = '#ffe27a';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      const labelR = R + 26;
      const lx = cx + Math.cos(a) * labelR;
      const ly = cy + Math.sin(a) * labelR + 4;
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      ctx.fillText(mol.name, lx, ly);
      ctx.shadowBlur = 0;
      // Mini reward dots inside ring
      let dy = 0;
      ctx.globalAlpha = 0.9;
      const ix = cx + Math.cos(a) * (R - 14);
      const iy = cy + Math.sin(a) * (R - 14);
      if (mol.co2) { ctx.fillStyle = '#aaa'; ctx.beginPath(); ctx.arc(ix - 6, iy + dy, 3, 0, Math.PI * 2); ctx.fill(); }
      if (mol.nadh) { ctx.fillStyle = '#7ec8ff'; ctx.beginPath(); ctx.arc(ix, iy + dy, 3, 0, Math.PI * 2); ctx.fill(); }
      if (mol.fadh2) { ctx.fillStyle = '#ff9a9a'; ctx.beginPath(); ctx.arc(ix + 6, iy + dy, 3, 0, Math.PI * 2); ctx.fill(); }
      if (mol.atp) { ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(ix + 12, iy + dy, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    });

    // Center label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CITRIC ACID', cx, cy - 6);
    ctx.fillText('CYCLE', cx, cy + 10);

    // Player progress marker — 2 full turns over the level
    const lvlLen = 13400;
    const progress = Math.min(1, state.scrollX / lvlLen);
    const turn = progress * 2; // 2 turns per glucose
    const markerA = -Math.PI / 2 + (turn % 1) * Math.PI * 2;
    const mx = cx + Math.cos(markerA) * R;
    const my = cy + Math.sin(markerA) * R;
    ctx.shadowColor = '#b6ff7a';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#b6ff7a';
    ctx.beginPath();
    ctx.arc(mx, my, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`Turn ${Math.min(2, Math.floor(turn) + 1)}/2`, cx, cy + 70);

    ctx.restore();
  },
  bioStages: [
    {
      id: 'k-enter',
      x: 400,
      label: '🔄 ACETYL-CoA enters the Krebs (citric acid) cycle',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioAcetylCoA(ctx, sx + 600, 200, 1.0, 0.55);
        bioLabel(ctx, sx + 620, 260, 'will combine with oxaloacetate → citrate', 12, '#fff', 0.7);
      }
    },
    {
      id: 'k-turn1',
      x: 3000,
      label: '⚙️ TURN 1: 3 NADH, 1 FADH₂, 1 ATP, 2 CO₂ harvested',
      color: '#ffe27a',
      draw: (ctx, sx) => {
        bioNADH(ctx, sx + 480, 230, 0.8, 0.7);
        bioNADH(ctx, sx + 510, 230, 0.8, 0.7);
        bioNADH(ctx, sx + 540, 230, 0.8, 0.7);
        bioFADH2(ctx, sx + 580, 230, 0.8, 0.7);
        bioATP(ctx, sx + 620, 230, 0.7, 0.7);
        bioCO2(ctx, sx + 660, 230, 0.8, 0.7);
        bioCO2(ctx, sx + 690, 230, 0.8, 0.7);
      }
    },
    {
      id: 'k-turn2',
      x: 8000,
      label: '⚙️ TURN 2 (2nd Acetyl-CoA): another 3 NADH + 1 FADH₂ + 1 ATP + 2 CO₂',
      color: '#ffe27a',
      draw: (ctx, sx) => {
        bioNADH(ctx, sx + 480, 350, 0.8, 0.7);
        bioNADH(ctx, sx + 510, 350, 0.8, 0.7);
        bioNADH(ctx, sx + 540, 350, 0.8, 0.7);
        bioFADH2(ctx, sx + 580, 350, 0.8, 0.7);
        bioATP(ctx, sx + 620, 350, 0.7, 0.7);
        bioCO2(ctx, sx + 660, 350, 0.8, 0.7);
        bioCO2(ctx, sx + 690, 350, 0.8, 0.7);
      }
    },
    {
      id: 'k-result',
      x: 10500,
      label: '✅ KREBS COMPLETE: 6 NADH + 2 FADH₂ + 2 ATP + 4 CO₂ per glucose. All 6 carbons → CO₂!',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioLabel(ctx, sx, 320, 'NADH and FADH₂ → ETC next', 13, '#b6ff7a', 0.85);
      }
    }
  ]
});

// ----- LEVEL 4: ELECTRON TRANSPORT CHAIN (hardest — relentless ground gauntlet) -----
const Level4 = makeLevel({
  name: "Electron Transport Chain",
  location: "INNER MEMBRANE",
  description: "You are an electron flowing through the ETC. Maximum speed, relentless spike clusters, and tall blocks that require precise orb double-jumps. Survive to complete cellular respiration!",
  form: 'electron',
  speed: 7.8,
  length: 14800,
  // Deep red-brown — accurate inner mitochondrial membrane color (cytochromes are reddish from iron).
  // Bright blue accent for electrons flowing through the ETC (universal scientific convention).
  palette: {
    bgTop: '#3a1208',
    bgBottom: '#1a0608',
    ground: '#5a2818',
    ceiling: '#5a2818',
    accent: '#7ec8ff',
    block: '#a05030',
    danger: '#ffb030',
    parallax: ['180,80,60', '140,60,50', '100,40,30']
  },
  obstacles: obs([
    // ── COMPLEX I: NADH drops electrons (pumps H⁺) ──
    ['spike', 14],
    ['spike', 21],
    ['spike', 28], ['spike', 29],
    ['spike', 36],
    ['block', 43, 0, 1, 1],
    ['spike', 51],

    // ── COMPLEX II: FADH₂ enters (no H⁺ pumped) ──
    ['spike', 58], ['spike', 59],
    ['orb', 66, 4],
    ['block', 72, 0, 1, 2],     // 2-tile block, orb prep
    ['spike', 82],
    ['spike', 88], ['spike', 89], ['spike', 90],   // triple

    // ── COMPLEX III: more H⁺ pumping (Q cycle) ──
    ['spike', 99],
    ['pad', 106, 1],
    ['spike', 117], ['spike', 118], ['spike', 119],
    ['orb', 127, 4],
    ['block', 133, 0, 2, 2],     // 2-tall, 2-wide block, orb prep
    ['spike', 144],

    // ── COMPLEX IV: O₂ accepts electrons ──
    ['spike', 151], ['spike', 152],
    ['spike', 159],
    ['orb', 166, 4],
    ['block', 172, 0, 1, 2],
    ['spike', 182],
    ['spike', 188], ['spike', 189], ['spike', 190],   // triple

    // ── PROTON GRADIENT: H⁺ builds in intermembrane space ──
    ['spike', 198],
    ['pad', 205, 1],
    ['spike', 216], ['spike', 217], ['spike', 218], ['spike', 219],  // QUADRUPLE
    ['block', 228, 0, 1, 1],
    ['spike', 235],

    // ── ATP SYNTHASE: H⁺ flow makes ATP ──
    ['spike', 242], ['spike', 243],
    ['orb', 250, 4],
    ['block', 256, 0, 1, 2],
    ['spike', 266],
    ['spike', 272], ['spike', 273], ['spike', 274],
    ['orb', 282, 4],
    ['block', 288, 0, 2, 2],
    ['spike', 299],

    // ── FINAL: H₂O FORMS, ATP HARVEST COMPLETE ──
    ['spike', 306], ['spike', 307],
    ['pad', 315, 1],
    ['spike', 326], ['spike', 327], ['spike', 328], ['spike', 329], ['spike', 330],  // QUINTUPLE
    ['orb', 339, 4],
    ['spike', 346],
    ['block', 353, 0, 1, 1],
    ['spike', 360],
    ['end', 369]
  ]),
  drawAlways: (ctx, state) => {
    // Persistent ETC: 4 complexes + ATP synthase in the inner membrane (top bar)
    ctx.save();
    const yMembrane = 160;
    // Membrane band background
    ctx.fillStyle = 'rgba(60,120,180,0.18)';
    ctx.fillRect(0, yMembrane - 40, W, 80);
    ctx.strokeStyle = 'rgba(160,220,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yMembrane - 40); ctx.lineTo(W, yMembrane - 40);
    ctx.moveTo(0, yMembrane + 40); ctx.lineTo(W, yMembrane + 40);
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(200,230,255,0.55)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('INTERMEMBRANE SPACE (high H⁺)', 14, yMembrane - 48);
    ctx.fillText('MATRIX (low H⁺)', 14, yMembrane + 56);

    // Complexes
    const complexes = [
      { name: 'I',   xRatio: 0.16, color: '#7ec8ff', pumps: true,  acceptsFrom: 'NADH' },
      { name: 'II',  xRatio: 0.34, color: '#ff9a9a', pumps: false, acceptsFrom: 'FADH₂' },
      { name: 'III', xRatio: 0.52, color: '#b6ff7a', pumps: true,  acceptsFrom: null },
      { name: 'IV',  xRatio: 0.70, color: '#ffb87a', pumps: true,  acceptsFrom: null },
      { name: 'V',   xRatio: 0.88, color: '#ffe27a', pumps: false, acceptsFrom: 'H⁺ flows back', isATPSynthase: true }
    ];
    complexes.forEach(c => {
      const x = W * c.xRatio;
      ctx.fillStyle = c.color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x - 32, yMembrane - 35, 64, 70);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 32, yMembrane - 35, 64, 70);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.name, x, yMembrane);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = 'bold 9px sans-serif';
      if (c.acceptsFrom) ctx.fillText(c.acceptsFrom, x, yMembrane + 50);
      if (c.isATPSynthase) ctx.fillText('ATP synthase', x, yMembrane - 48);

      // Pump arrows (H+ upward)
      if (c.pumps) {
        const pulse = (Math.sin(state.elapsed * 0.005 + c.xRatio * 10) + 1) / 2;
        ctx.strokeStyle = `rgba(255,226,122,${0.4 + pulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, yMembrane + 30);
        ctx.lineTo(x, yMembrane - 30);
        ctx.moveTo(x - 5, yMembrane - 22);
        ctx.lineTo(x, yMembrane - 30);
        ctx.lineTo(x + 5, yMembrane - 22);
        ctx.stroke();
        // Floating H+
        const hy = yMembrane - 30 - pulse * 30;
        ctx.fillStyle = `rgba(255,226,122,${0.7 - pulse * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, hy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5a3a00';
        ctx.font = 'bold 7px sans-serif';
        ctx.fillText('H⁺', x, hy);
      }

      // ATP synthase rotor spinning
      if (c.isATPSynthase) {
        ctx.save();
        ctx.translate(x, yMembrane);
        ctx.rotate(state.elapsed * 0.006);
        ctx.strokeStyle = '#5a3a00';
        ctx.lineWidth = 2;
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
          ctx.stroke();
        }
        ctx.restore();
      }
    });

    // Animated electrons flowing through complexes (Complex I → II/III → IV)
    for (let i = 0; i < 6; i++) {
      const t = (state.elapsed * 0.0006 + i * 0.18) % 1;
      const x = W * (0.10 + t * 0.66);
      const wave = Math.sin(t * Math.PI * 4) * 5;
      ctx.fillStyle = `rgba(126,200,255,${0.85 - t * 0.4})`;
      ctx.shadowColor = '#7ec8ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, yMembrane + wave, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  },
  bioStages: [
    {
      id: 'e-enter',
      x: 400,
      label: '⚡ ELECTRONS enter Complex I via NADH',
      color: '#7ec8ff',
      draw: (ctx, sx) => {
        bioNADH(ctx, sx + 50, 350, 1.2, 0.65);
        bioArrow(ctx, sx + 80, 320, sx + 130, 220, '#7ec8ff', 0.6);
        bioLabel(ctx, sx + 70, 400, 'NADH drops e⁻ at Complex I', 12, '#7ec8ff', 0.8);
      }
    },
    {
      id: 'e-fadh',
      x: 2500,
      label: 'FADH₂ delivers electrons to Complex II',
      color: '#ff9a9a',
      draw: (ctx, sx) => {
        bioFADH2(ctx, sx + 50, 350, 1.2, 0.65);
        bioArrow(ctx, sx + 80, 320, sx + 130, 220, '#ff9a9a', 0.6);
        bioLabel(ctx, sx + 80, 400, 'FADH₂ → less ATP (skips Complex I)', 12, '#ff9a9a', 0.8);
      }
    },
    {
      id: 'e-pump',
      x: 4500,
      label: '💪 CHEMIOSMOSIS: H⁺ pumped across membrane, building gradient',
      color: '#ffe27a',
      draw: (ctx, sx) => {
        bioLabel(ctx, sx + 70, 400, 'high H⁺ outside, low H⁺ inside', 12, '#fff', 0.75);
      }
    },
    {
      id: 'e-atp',
      x: 7000,
      label: '⚙️ ATP SYNTHASE: H⁺ flows back through, spins rotor → +ATP',
      color: '#ffe27a',
      draw: (ctx, sx) => {
        bioATP(ctx, sx + 60, 360, 1.1, 0.85);
        bioATP(ctx, sx + 100, 360, 1.1, 0.85);
        bioATP(ctx, sx + 140, 360, 1.1, 0.85);
        bioLabel(ctx, sx + 100, 410, '~26-28 ATP made here per glucose', 12, '#ffe27a', 0.85);
      }
    },
    {
      id: 'e-o2',
      x: 9500,
      label: '💧 OXYGEN accepts the final electrons → forms WATER (H₂O)',
      color: '#90e0ff',
      draw: (ctx, sx) => {
        bioOxygen(ctx, sx + 30, 380, 1.0, 0.85);
        bioArrow(ctx, sx + 50, 380, sx + 100, 380, '#fff', 0.7);
        bioH2O(ctx, sx + 130, 380, 1.0, 0.85);
        bioLabel(ctx, sx + 80, 430, 'this is WHY we breathe O₂', 12, '#90e0ff', 0.85);
      }
    },
    {
      id: 'e-result',
      x: 11500,
      label: '✅ RESPIRATION COMPLETE: 1 glucose → ~32 ATP + 6 CO₂ + 6 H₂O',
      color: '#b6ff7a',
      draw: (ctx, sx) => {
        bioLabel(ctx, sx, 400, '🎉 you just simulated what every cell does, every second', 13, '#b6ff7a', 0.9);
      }
    }
  ]
});

const LEVELS = [Level1, Level2, Level3, Level4];
