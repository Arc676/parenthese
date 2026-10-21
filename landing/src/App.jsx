import { useEffect, useRef, useState } from 'react'
import { analytics } from './analytics.js'
import { getEntranceProgress, seededFloat } from './heroGraphMath.js'
import PzMark from './PzMark.jsx'
import LogoLockup from './LogoLockup.jsx'
import { COPY, withAppQuery } from './i18n.js'

// ─── Design atoms ─────────────────────────────────────────────────────────────

// Logo validé le 24/09/2026 (symbole Young Serif + nom Newsreader vectorisé), rapport 7,541
function Logo({ height = 22 }) {
  return (
    <img src="/logo.svg" alt="Parenthèse" className="lg" width={Math.round(height * 7.541)} height={height} style={{ height }} />
  )
}

// Hauteurs fixes de l'onde du lecteur vocal (pas d'aléatoire au rendu)
const WAVE = [38, 62, 48, 80, 56, 92, 70, 44, 66, 86, 52, 74, 40, 60, 90, 58, 46, 72, 84, 50, 64, 42, 76, 54, 36, 68]

// ─── Mini graphe hero (noeuds interactifs) ───────────────────────────────────

function HeroGraph({ className = '', label }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const WORLD_W = 760
    const WORLD_H = 530
    const PERSON_R = 62
    const ORBIT_RADIUS = 96
    const ORBIT_MEDIA_SIZE = 30

    const ENTRANCE_GEN_DELAY = 500
    const ENTRANCE_NODE_DURATION = 700
    const ENTRANCE_NODE_STAGGER = 80
    const ENTRANCE_LINE_DELAY = 200
    const ENTRANCE_LINE_DURATION = 500
    const ENTRANCE_ORBIT_DELAY = 300
    const ENTRANCE_ORBIT_DURATION = 400
    const ENTRANCE_ORBIT_STAGGER = 100

    const TARGET_FRAME_MS = 1000 / 45

    const nodes = [
      {
        id: 'p-mother',
        firstName: 'Camille',
        years: '1987',
        frameType: 'polaroid',
        photo: '/hero/photos/camille-39.webp',
        x: 158,
        y: 168,
        medias: [
          { type: 'photo', url: '/hero/photos/souvenir-1519741497674.webp' },
          { type: 'audio' },
          { type: 'document' },
        ],
      },
      {
        id: 'p-father',
        firstName: 'Alex',
        years: '1985',
        frameType: 'rect',
        photo: '/hero/photos/alex-41.webp',
        x: 602,
        y: 168,
        medias: [
          { type: 'photo', url: '/hero/photos/souvenir-1511895426328.webp' },
          { type: 'video' },
          { type: 'citation' },
        ],
      },
      {
        id: 'p-child',
        firstName: 'Lya',
        years: '2012',
        frameType: 'round',
        photo: '/hero/photos/lya-14.webp',
        x: 380,
        y: 432,
        medias: [
          { type: 'photo', url: '/hero/photos/souvenir-1503919545889.webp' },
          { type: 'photo', url: '/hero/photos/souvenir-1472162072942.webp' },
          { type: 'document' },
        ],
      },
    ]

    const schedule = {
      nodeStart: new Map(),
      orbitStart: new Map(),
      coupleStart: 0,
      filiationStart: 0,
    }

    schedule.nodeStart.set('p-mother', 0)
    schedule.nodeStart.set('p-father', ENTRANCE_NODE_STAGGER)
    schedule.nodeStart.set('p-child', ENTRANCE_GEN_DELAY + ENTRANCE_NODE_STAGGER * 0.7)

    let totalEntranceMs = 0

    nodes.forEach((node) => {
      const base = schedule.nodeStart.get(node.id) + ENTRANCE_NODE_DURATION + ENTRANCE_ORBIT_DELAY
      totalEntranceMs = Math.max(totalEntranceMs, schedule.nodeStart.get(node.id) + ENTRANCE_NODE_DURATION)
      node.medias.forEach((_, idx) => {
        const orbitStart = base + idx * ENTRANCE_ORBIT_STAGGER
        schedule.orbitStart.set(`${node.id}:${idx}`, orbitStart)
        totalEntranceMs = Math.max(totalEntranceMs, orbitStart + ENTRANCE_ORBIT_DURATION)
      })
    })

    schedule.coupleStart = Math.max(
      schedule.nodeStart.get('p-mother'),
      schedule.nodeStart.get('p-father'),
    ) + ENTRANCE_NODE_DURATION * 0.5 + ENTRANCE_LINE_DELAY * 0.3
    schedule.filiationStart = schedule.coupleStart + ENTRANCE_LINE_DELAY * 0.65

    totalEntranceMs = Math.max(totalEntranceMs, schedule.coupleStart + ENTRANCE_LINE_DURATION)
    totalEntranceMs = Math.max(totalEntranceMs, schedule.filiationStart + ENTRANCE_LINE_DURATION)

    const imageCache = new Map()
    const pending = new Set()
    const floating = new Map()
    const runtime = {
      reducedMotion: false,
      inView: true,
      tabVisible: !document.hidden,
      running: false,
      rafId: 0,
      startTime: -1,
      lastFrameTs: 0,
      mouseX: -1,
      mouseY: -1,
      targetHovers: new Map(),
    }

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    runtime.reducedMotion = mq.matches

    nodes.forEach((node) => {
      runtime.targetHovers.set(node.id, 0)
      floating.set(node.id, {
        offsetX: (seededFloat(node.id, 1) - 0.5) * 10,
        offsetY: (seededFloat(node.id, 2) - 0.5) * 10,
        phaseX: seededFloat(node.id, 3) * Math.PI * 2,
        phaseY: seededFloat(node.id, 4) * Math.PI * 2,
        floatSpeedX: 0.00032 + seededFloat(node.id, 5) * 0.00018,
        floatSpeedY: 0.00033 + seededFloat(node.id, 6) * 0.00018,
        floatAmpX: 0.9 + seededFloat(node.id, 7) * 0.7,
        floatAmpY: 0.9 + seededFloat(node.id, 8) * 0.7,
        frameRotation: (seededFloat(node.id, 9) - 0.5) * 0.11,
        labelRotation: (seededFloat(node.id, 10) - 0.5) * 0.08,
        orbitSlots: node.medias.map((_, idx) => {
          const orbitBase = node.id === 'p-child' ? ORBIT_RADIUS - 18 : ORBIT_RADIUS
          const safeArc = Math.PI * 1.5
          const baseAngle = 3 * Math.PI / 4 + (safeArc * (idx + 0.5) / 3)
          return {
            angle: baseAngle + (seededFloat(`${node.id}-orbit-${idx}`, 11) - 0.5) * 0.38,
            dist: orbitBase + (seededFloat(`${node.id}-orbit-${idx}`, 12) - 0.5) * 14,
            rot: (seededFloat(`${node.id}-orbit-${idx}`, 13) - 0.5) * 0.26,
          }
        }),
      })
    })

    const ensureImage = (url) => {
      if (!url || imageCache.has(url) || pending.has(url)) return
      pending.add(url)
      const image = new Image()
      image.onload = () => {
        imageCache.set(url, image)
        pending.delete(url)
        startLoop()
      }
      image.onerror = () => {
        pending.delete(url)
        startLoop()
      }
      image.src = url
    }

    nodes.forEach((node) => {
      ensureImage(node.photo)
      node.medias.forEach((media) => ensureImage(media.url))
    })

    const drawImageCover = (ctx, img, x, y, w, h) => {
      const sourceW = img.naturalWidth || img.width
      const sourceH = img.naturalHeight || img.height
      if (!sourceW || !sourceH || !w || !h) return

      const sourceRatio = sourceW / sourceH
      const targetRatio = w / h
      let sx = 0
      let sy = 0
      let sw = sourceW
      let sh = sourceH

      if (sourceRatio > targetRatio) {
        sw = sourceH * targetRatio
        sx = (sourceW - sw) / 2
      } else if (sourceRatio < targetRatio) {
        sh = sourceW / targetRatio
        sy = (sourceH - sh) / 2
      }

      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
    }

    const drawPartialBezier = (ctx, x0, y0, cp1x, cp1y, cp2x, cp2y, x3, y3, t) => {
      if (t <= 0) return
      if (t >= 1) {
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3)
        ctx.stroke()
        return
      }

      const mt = 1 - t
      const q1x = mt * x0 + t * cp1x
      const q1y = mt * y0 + t * cp1y
      const q2x = mt * cp1x + t * cp2x
      const q2y = mt * cp1y + t * cp2y
      const q3x = mt * cp2x + t * x3
      const q3y = mt * cp2y + t * y3
      const r1x = mt * q1x + t * q2x
      const r1y = mt * q1y + t * q2y
      const r2x = mt * q2x + t * q3x
      const r2y = mt * q2y + t * q3y
      const sx = mt * r1x + t * r2x
      const sy = mt * r1y + t * r2y

      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.bezierCurveTo(q1x, q1y, r1x, r1y, sx, sy)
      ctx.stroke()
    }

    const drawFadingRay = (ctx, fromX, fromY, toX, toY, alpha = 0.5) => {
      const gradient = ctx.createLinearGradient(fromX, fromY, toX, toY)
      gradient.addColorStop(0, `rgba(42,38,34,${alpha})`)
      gradient.addColorStop(0.58, `rgba(42,38,34,${alpha})`)
      gradient.addColorStop(1, 'rgba(42,38,34,0)')

      ctx.strokeStyle = gradient
      ctx.lineWidth = 0.55
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(fromX, fromY)
      ctx.lineTo(toX, toY)
      ctx.stroke()
    }

    const drawMediaContent = (ctx, media, size) => {
      const half = size
      const loaded = media.url ? imageCache.get(media.url) : null

      if (media.type === 'photo' && loaded) {
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(-half, -half, half * 2, half * 2, 1)
        ctx.clip()
        drawImageCover(ctx, loaded, -half, -half, half * 2, half * 2)
        ctx.restore()
        return
      }

      if (media.type === 'audio') {
        ctx.fillStyle = '#2A2622'
        ctx.beginPath()
        ctx.arc(0, 0, half, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(251, 250, 247, 0.08)'
        ctx.lineWidth = 0.5
        for (let r = 4; r < half; r += 3) {
          ctx.beginPath()
          ctx.arc(0, 0, r, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = '#D2694A'
        ctx.beginPath()
        ctx.arc(0, 0, 5.5, 0, Math.PI * 2)
        ctx.fill()
        return
      }

      if (media.type === 'video') {
        ctx.fillStyle = '#3D3731'
        ctx.beginPath()
        ctx.roundRect(-half, -half, half * 2, half * 2, 1)
        ctx.fill()
        ctx.fillStyle = 'rgba(251, 250, 247, 0.72)'
        ctx.beginPath()
        ctx.moveTo(-4, -5)
        ctx.lineTo(-4, 5)
        ctx.lineTo(5, 0)
        ctx.closePath()
        ctx.fill()
        return
      }

      if (media.type === 'citation') {
        ctx.fillStyle = '#F8E4DB'
        ctx.beginPath()
        ctx.roundRect(-half, -half, half * 2, half * 2, 1)
        ctx.fill()
        ctx.fillStyle = '#93402A'
        ctx.font = `400 ${half * 1.1}px "Newsreader", Georgia, serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('"', 0, -half * 0.2)
        return
      }

      ctx.fillStyle = '#FCF3EF'
      ctx.beginPath()
      ctx.moveTo(-half, -half)
      ctx.lineTo(half - 5, -half)
      ctx.lineTo(half, -half + 5)
      ctx.lineTo(half, half)
      ctx.lineTo(-half, half)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(42, 38, 34, 0.15)'
      for (let idx = 0; idx < 5; idx += 1) {
        const y = -half + 8 + idx * 6
        const w = idx === 4 ? half * 0.7 : half * 1.35
        ctx.fillRect(-half + 4, y, w, 1.5)
      }
    }

    const drawFrame = (ctx, frameType, node, image) => {
      if (frameType === 'polaroid') {
        const side = PERSON_R + 4
        const pad = 4
        const bottomPad = 12
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.roundRect(-side - pad, -side - pad, (side + pad) * 2, (side + pad) + side + bottomPad, 3)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.strokeStyle = 'rgba(42, 38, 34, 0.08)'
        ctx.lineWidth = 0.5
        ctx.stroke()
        ctx.beginPath()
        ctx.roundRect(-side, -side, side * 2, side * 2, 2)
        ctx.clip()
        if (image) drawImageCover(ctx, image, -side, -side, side * 2, side * 2)
      } else if (frameType === 'rect') {
        const rw = PERSON_R + 12
        const rh = PERSON_R - 8
        const pad = 3
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.roundRect(-rw - pad, -rh - pad, (rw + pad) * 2, (rh + pad) * 2, 5)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.strokeStyle = 'rgba(42, 38, 34, 0.08)'
        ctx.lineWidth = 0.5
        ctx.stroke()
        ctx.beginPath()
        ctx.roundRect(-rw, -rh, rw * 2, rh * 2, 3)
        ctx.clip()
        if (image) drawImageCover(ctx, image, -rw, -rh, rw * 2, rh * 2)
      } else {
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.arc(0, 0, PERSON_R + 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.strokeStyle = '#D2694A'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0, PERSON_R, 0, Math.PI * 2)
        ctx.clip()
        if (image) drawImageCover(ctx, image, -PERSON_R, -PERSON_R, PERSON_R * 2, PERSON_R * 2)
      }

      if (!image) {
        ctx.fillStyle = '#F8E4DB'
        ctx.fillRect(-PERSON_R, -PERSON_R, PERSON_R * 2, PERSON_R * 2)
        ctx.fillStyle = '#2A2622'
        ctx.font = '400 22px "Newsreader", Georgia, serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.firstName[0], 0, 0)
      }
    }

    const shouldRun = () => runtime.inView && runtime.tabVisible

    const stopLoop = () => {
      if (runtime.rafId) window.cancelAnimationFrame(runtime.rafId)
      runtime.rafId = 0
      runtime.running = false
      runtime.lastFrameTs = 0
    }

    const queueFrame = () => {
      runtime.rafId = window.requestAnimationFrame(render)
      runtime.running = true
    }

    const startLoop = (resetStart = false) => {
      if (resetStart) runtime.startTime = -1
      if (!shouldRun()) return
      if (runtime.running) return
      queueFrame()
    }

    const render = (timestamp) => {
      if (!shouldRun()) {
        stopLoop()
        return
      }

      if (runtime.lastFrameTs > 0 && timestamp - runtime.lastFrameTs < TARGET_FRAME_MS) {
        queueFrame()
        return
      }
      runtime.lastFrameTs = timestamp

      if (runtime.startTime < 0) runtime.startTime = timestamp
      const reduced = runtime.reducedMotion
      const elapsed = reduced ? totalEntranceMs + 200 : (timestamp - runtime.startTime)

      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW < 2 || cssH < 2) {
        queueFrame()
        return
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const pxW = Math.max(1, Math.round(cssW * dpr))
      const pxH = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW
        canvas.height = pxH
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        queueFrame()
        return
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const isMobileLayout = window.innerWidth <= 768
      const pad = isMobileLayout ? 10 : 26
      const baseScale = Math.min((cssW - pad * 2) / WORLD_W, (cssH - pad * 2) / WORLD_H)
      const scale = isMobileLayout ? baseScale * 1.18 : baseScale
      const tx = (cssW - WORLD_W * scale) / 2
      const ty = (cssH - WORLD_H * scale) / 2
      ctx.save()
      ctx.translate(tx, ty)
      ctx.scale(scale, scale)

      const positions = new Map()
      nodes.forEach((node) => {
        const rd = floating.get(node.id)
        const nodeP = getEntranceProgress(elapsed, schedule.nodeStart.get(node.id), ENTRANCE_NODE_DURATION, reduced)
        if (nodeP <= 0) return

        const floatX = reduced ? 0 : Math.sin(timestamp * rd.floatSpeedX + rd.phaseX) * rd.floatAmpX
        const floatY = reduced ? 0 : Math.sin(timestamp * rd.floatSpeedY + rd.phaseY) * rd.floatAmpY

        positions.set(node.id, {
          x: node.x + rd.offsetX + floatX,
          y: node.y + rd.offsetY + floatY,
          p: nodeP,
        })
      })

      const mother = positions.get('p-mother')
      const father = positions.get('p-father')
      const child = positions.get('p-child')
      const union = mother && father
        ? { x: (mother.x + father.x) / 2, y: (mother.y + father.y) / 2 + 7 }
        : null

      const coupleP = getEntranceProgress(elapsed, schedule.coupleStart, ENTRANCE_LINE_DURATION, reduced)
      if (mother && father && union && coupleP > 0) {
        const left = mother.x < father.x ? mother : father
        const right = mother.x < father.x ? father : mother

        const leftStart = { x: left.x + PERSON_R, y: left.y }
        const rightStart = { x: right.x - PERSON_R, y: right.y }

        ctx.strokeStyle = '#2A2622'
        ctx.lineWidth = 0.5
        ctx.lineCap = 'round'
        ctx.globalAlpha = coupleP

        drawPartialBezier(
          ctx,
          leftStart.x,
          leftStart.y,
          leftStart.x + (union.x - leftStart.x) * 0.55,
          leftStart.y,
          union.x - (union.x - leftStart.x) * 0.1,
          union.y,
          union.x,
          union.y,
          coupleP,
        )

        drawPartialBezier(
          ctx,
          rightStart.x,
          rightStart.y,
          rightStart.x + (union.x - rightStart.x) * 0.55,
          rightStart.y,
          union.x - (union.x - rightStart.x) * 0.1,
          union.y,
          union.x,
          union.y,
          coupleP,
        )

        ctx.globalAlpha = 1
      }

      const filiationP = getEntranceProgress(elapsed, schedule.filiationStart, ENTRANCE_LINE_DURATION, reduced)
      if (child && union && filiationP > 0) {
        const sx = union.x
        const sy = union.y
        const ex = child.x
        const ey = child.y - PERSON_R
        const dy = ey - sy

        ctx.strokeStyle = '#2A2622'
        ctx.lineWidth = 0.5
        ctx.lineCap = 'round'
        ctx.globalAlpha = Math.min(1, filiationP * 1.5)
        drawPartialBezier(ctx, sx, sy, sx, sy + dy * 0.75, ex, ey - dy * 0.15, ex, ey, filiationP)
        ctx.globalAlpha = 1
      }

      if (mother && father && child) {
        const motherRayAlpha = 0.52 * mother.p
        const fatherRayAlpha = 0.52 * father.p
        const childRayAlpha = 0.56 * child.p

        drawFadingRay(
          ctx,
          mother.x - 2,
          mother.y - PERSON_R + 2,
          mother.x - 12,
          mother.y - PERSON_R - 156,
          motherRayAlpha,
        )
        drawFadingRay(
          ctx,
          father.x + 2,
          father.y - PERSON_R + 2,
          father.x + 12,
          father.y - PERSON_R - 156,
          fatherRayAlpha,
        )
        drawFadingRay(
          ctx,
          child.x + PERSON_R - 2,
          child.y + 1,
          child.x + PERSON_R + 156,
          child.y + 9,
          childRayAlpha,
        )
      }

      if (union && filiationP > 0.15) {
        ctx.fillStyle = '#2A2622'
        ctx.globalAlpha = filiationP
        ctx.beginPath()
        ctx.arc(union.x, union.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      nodes.forEach((node) => {
        const pos = positions.get(node.id)
        if (!pos) return

        const rd = floating.get(node.id)
        const personImg = imageCache.get(node.photo)
        const nodeP = pos.p

        let hVal = runtime.targetHovers.get(node.id) || 0
        let targetH = 0

        if (runtime.mouseX >= 0 && runtime.mouseY >= 0) {
          const cx = tx + pos.x * scale
          const cy = ty + pos.y * scale
          const dx = runtime.mouseX - cx
          const dy = runtime.mouseY - cy
          if (dx * dx + dy * dy < (PERSON_R * scale * 1.5) ** 2) {
            targetH = 1
          }
        }

        hVal += (targetH - hVal) * 0.15
        runtime.targetHovers.set(node.id, hVal)
        const nodeHover = hVal

        if (Math.abs(targetH - hVal) > 0.01) {
          queueFrame()
        }

        node.medias.forEach((media, idx) => {
          const key = `${node.id}:${idx}`
          const orbitP = getEntranceProgress(elapsed, schedule.orbitStart.get(key), ENTRANCE_ORBIT_DURATION, reduced)
          if (orbitP <= 0) return

          const slot = rd.orbitSlots[idx]
          const mx = pos.x + Math.cos(slot.angle) * slot.dist
          const my = pos.y + Math.sin(slot.angle) * slot.dist
          const mediaScale = (0.3 + orbitP * 0.7)
          const size = ORBIT_MEDIA_SIZE

          ctx.save()
          ctx.globalAlpha = nodeP * orbitP
          ctx.translate(mx, my)
          ctx.scale(mediaScale, mediaScale)
          ctx.rotate(slot.rot)

          ctx.shadowColor = 'rgba(42, 38, 34, 0.18)'
          ctx.shadowBlur = 4
          ctx.shadowOffsetY = 1

          ctx.fillStyle = '#FFFFFF'
          ctx.beginPath()
          ctx.roundRect(-size - 2, -size - 2, (size + 2) * 2, (size + 2) * 2 + 4, 2)
          ctx.fill()

          ctx.shadowColor = 'transparent'
          ctx.shadowBlur = 0
          drawMediaContent(ctx, media, size)
          ctx.restore()
        })

        const glowR = PERSON_R + 12 + nodeHover * 6
        const glowAlpha = 0.15 + nodeHover * 0.1
        const nodeGlow = ctx.createRadialGradient(pos.x, pos.y, PERSON_R * 0.6, pos.x, pos.y, glowR)
        nodeGlow.addColorStop(0, `rgba(210, 105, 74, ${glowAlpha * nodeP})`)
        nodeGlow.addColorStop(1, 'rgba(210, 105, 74, 0)')
        ctx.fillStyle = nodeGlow
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2)
        ctx.fill()

        const scaleIn = (0.3 + nodeP * 0.7) * (1 + nodeHover * 0.1)
        const frameRot = reduced ? rd.frameRotation * 0.5 : rd.frameRotation

        ctx.save()
        ctx.globalAlpha = nodeP
        ctx.translate(pos.x, pos.y)
        ctx.scale(scaleIn, scaleIn)
        ctx.rotate(frameRot)
        ctx.shadowColor = `rgba(42, 38, 34, ${0.15 + nodeHover * 0.1})`
        ctx.shadowBlur = 10 + nodeHover * 14
        ctx.shadowOffsetY = 3 + nodeHover * 4
        drawFrame(ctx, node.frameType, node, personImg)
        ctx.restore()

        ctx.save()
        ctx.globalAlpha = nodeP
        ctx.translate(pos.x, pos.y + PERSON_R + 30)
        ctx.rotate(rd.labelRotation)
        ctx.fillStyle = '#2A2622'
        ctx.font = '400 22px "Newsreader", Georgia, serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.firstName, 0, 0)
        ctx.fillStyle = '#6B645D'
        ctx.font = '400 14px "DM Sans", system-ui, sans-serif'
        ctx.fillText(node.years, 0, 22)
        ctx.restore()
      })

      ctx.restore()

      const entranceDone = elapsed > totalEntranceMs + 250
      if (reduced && entranceDone) {
        stopLoop()
        return
      }

      queueFrame()
    }

    const onMotionPreferenceChange = () => {
      runtime.reducedMotion = mq.matches
      startLoop(true)
    }

    const onVisibilityChange = () => {
      runtime.tabVisible = !document.hidden
      if (!runtime.tabVisible) {
        stopLoop()
      } else {
        startLoop()
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        runtime.inView = Boolean(entry?.isIntersecting)
        if (runtime.inView) {
          startLoop()
        } else {
          stopLoop()
        }
      },
      { threshold: 0.12 },
    )

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      runtime.mouseX = e.clientX - rect.left
      runtime.mouseY = e.clientY - rect.top
      startLoop()
    }

    const onMouseLeave = () => {
      runtime.mouseX = -1
      runtime.mouseY = -1
      startLoop()
    }

    observer.observe(container)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseleave', onMouseLeave)
    document.addEventListener('visibilitychange', onVisibilityChange)
    mq.addEventListener('change', onMotionPreferenceChange)

    startLoop(true)

    return () => {
      stopLoop()
      observer.disconnect()
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      mq.removeEventListener('change', onMotionPreferenceChange)
    }
  }, [])

  return (
    <div ref={containerRef} className={`relative w-full max-w-2xl mx-auto lg:mx-0 hero-graph ${className}`} data-reveal data-hero-galaxy>
      <canvas
        ref={canvasRef}
        className="block w-full h-[40svh] sm:h-[clamp(420px,92vw,560px)] lg:h-[clamp(480px,36vw,560px)]"
        aria-label={label}
      />
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ t, onCta, loginHref, elevated }) {
  return (
    <header className={`site-nav${elevated ? ' is-elevated' : ''}`}>
      <div className="wrap nav-in">
        <a href={t.home} aria-label={t.logoHome} className="site-logo">
          {/* Sur téléphone, le symbole seul : le nom « Parenthèse » reste dans le nom accessible du lien */}
          <LogoLockup height={22} className="lg lk lk-full" decorative />
          <LogoLockup height={24} mark className="lg lk lk-mark" decorative />
        </a>
        <nav aria-label="Sections">
          <a href="#comment">{t.nav.how}</a>
          <a href="#demo">{t.nav.demo}</a>
          {t.nav.privacy && <a href={t.privacyHref}>{t.nav.privacy}</a>}
        </nav>
        <div className="nav-cta">
          <a href={loginHref} className="btn s sm nav-login" aria-label={t.nav.login}>
            {/* Silhouette de profil, icône « user » de Lucide (ISC), tracée à la main : la landing n'embarque pas la bibliothèque */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="7" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
            <span className="nav-login-text">{t.nav.login}</span>
          </a>
          <button type="button" onClick={onCta} className="btn p sm">{t.cta}</button>
        </div>
      </div>
    </header>
  )
}

// ─── Démo inline ──────────────────────────────────────────────────────────────

function InlineDemo({ t, locale }) {
  const [active, setActive] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(false)
  // Faux au prérendu comme au premier rendu client (hydratation identique), corrigé par l'effet ci-dessous
  const [isMobile, setIsMobile] = useState(false)
  const sectionRef = useRef(null)

  // L'iframe de l'app (500 Ko de JS + la galaxie) ne se charge qu'à l'approche de la section,
  // pour ne pas alourdir le premier affichage de la landing (TBT, LCP).
  useEffect(() => {
    const el = sectionRef.current
    if (!el || shouldLoad) return
    if (!('IntersectionObserver' in window)) { setShouldLoad(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setShouldLoad(true); observer.disconnect() }
    }, { rootMargin: '400px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [shouldLoad])

  // Déactivation automatique au scroll (l'iframe ne vole pas le scroll)
  useEffect(() => {
    const onScroll = () => { if (active) setActive(false) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [active])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)')
    const onChange = (event) => setIsMobile(event.matches)
    setIsMobile(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return (
    <section id="demo" ref={sectionRef} className="sec sec-demo">
      <div className="wrap sec-in">
        <div className="head c" data-reveal>
          <span className="eyebrow">{t.demo.eyebrow}</span>
          <h2 className="t-d2">{t.demo.title[0]}<em className="s">{t.demo.title[1]}</em></h2>
          <p className="lede">{t.demo.lede}</p>
        </div>

        <div className="demo-frame" data-reveal>
          <div
            className="relative"
            style={isMobile
              ? { minHeight: '66vh', height: '88vw', maxHeight: '780px' }
              : { minHeight: '52vh', height: '56vw', maxHeight: '720px' }}
          >
            {/* Capture fixe de l'arbre de démo sous l'iframe : le bloc montre le vrai arbre avant le chargement,
                aux captures d'écran comme aux visiteurs. Refaite depuis app.parenthese.io/?embed si l'arbre change. */}
            <picture className="demo-poster">
              <source media="(max-width: 768px)" srcSet={`/demo/arbre-demo-${locale}-mobile.webp`} width="712" height="1110" />
              <img
                src={`/demo/arbre-demo-${locale}-large.webp`}
                alt={loaded ? '' : t.demo.poster}
                width="2204"
                height="1436"
                loading="lazy"
                decoding="async"
              />
            </picture>

            {!loaded && (
              <div className={active ? 'demo-wait is-on' : 'demo-wait'} role="status">
                {active && <PzMark state="loading" />}
                <span className="sr-only">{shouldLoad ? t.demo.loading : t.demo.idle}</span>
              </div>
            )}

            <iframe
              src={shouldLoad ? withAppQuery(`https://app.parenthese.io/?embed&source=${appSource()}`, locale) : undefined}
              title={t.demo.frameTitle}
              loading="lazy"
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => { if (shouldLoad) setLoaded(true) }}
              style={{
                pointerEvents: active ? 'auto' : 'none',
                opacity: loaded ? 1 : 0,
                width: isMobile ? '122%' : '100%',
                height: isMobile ? '122%' : '100%',
                transform: isMobile ? 'scale(0.82)' : 'none',
                transformOrigin: 'top left',
                transition: 'opacity 0.4s ease',
              }}
            />

            {!active && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActive(true)}
                onKeyDown={(e) => e.key === 'Enter' && setActive(true)}
                className="demo-enter"
                aria-label={t.demo.enter}
              >
                <span className="btn w">{t.demo.enter}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

const readSource = () => new URLSearchParams(window.location.search).get('source') || 'direct'

// Source transmise à l'app : celle de l'arrivée sur la landing (?source=hn...), sinon « landing ».
// L'app la garde jusqu'à l'inscription (frontend/src/utils/analytics.js, rememberSource).
const appSource = () => {
  const source = readSource()
  return source === 'direct' ? 'landing' : encodeURIComponent(source)
}

// Les CTA mènent à la création de compte dans l'app
const appSignupUrl = () => `https://app.parenthese.io/?account=register&source=${appSource()}`
// Un compte déjà créé : la connexion, pas l'inscription (sans source : rendu au build, pas de window)
const appLoginUrl = () => 'https://app.parenthese.io/?account=login'

export default function App({ locale = 'fr' }) {
  const t = COPY[locale]
  const [headerElevated, setHeaderElevated] = useState(false)
  const scrollMilestonesRef = useRef({ half: false, full: false })

  // La page est prérendue à la compilation, sans URL : le premier rendu est toujours la variante
  // par défaut, puis la variante `app-shared` est posée après le montage (pas d'écart d'hydratation).
  const [source, setSource] = useState('direct')
  useEffect(() => { setSource(readSource()) }, [])

  const buildEventProps = (extra = {}) => ({
    source: readSource(),
    referrer: document.referrer || 'none',
    viewport: window.innerWidth < 768 ? 'mobile' : 'desktop',
    lang: locale,
    ...extra,
  })

  useEffect(() => {
    analytics.capture('page_viewed', buildEventProps())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bordure du header au défilement + paliers de scroll pour PostHog
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || 0
      setHeaderElevated(y > 12)

      const doc = document.documentElement
      const scrollHeight = Math.max(0, doc.scrollHeight - window.innerHeight)
      const progress = scrollHeight > 0 ? y / scrollHeight : 1

      if (!scrollMilestonesRef.current.half && progress >= 0.5) {
        scrollMilestonesRef.current.half = true
        analytics.capture('scroll_depth_50', buildEventProps())
      }

      if (!scrollMilestonesRef.current.full && progress >= 0.99) {
        scrollMilestonesRef.current.full = true
        analytics.capture('scroll_depth_100', buildEventProps())
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Révélations douces des sections
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('is-visible')
        })
      },
      { threshold: 0.22, rootMargin: '0px 0px -5% 0px' }
    )
    document.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Vers la création de compte dans l'app. Un seul événement, signup_cta_clicked (celui du funnel PostHog
  // « landing → écran compte → compte créé → arbre créé »), envoyé avant de quitter la page.
  const goToSignup = (placement = 'hero') => {
    analytics.captureThenNavigate(
      'signup_cta_clicked',
      buildEventProps({ placement }),
      withAppQuery(appSignupUrl(), locale)
    )
  }

  return (
    <div className="min-h-screen">

      <Header t={t} onCta={() => goToSignup('header')} loginHref={withAppQuery(appLoginUrl(), locale)} elevated={headerElevated} />
      <main>

      {/* ─── HERO ────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="wrap hero-in">
          <HeroGraph className="order-1 lg:order-2" label={t.heroCanvas} />

          <div className="hero-txt order-2 lg:order-1">
            <span className="pill rise"><i />{t.hero.pill}</span>
            <h1 className="t-d1 rise" style={{ animationDelay: '80ms' }}>
              {t.hero.title[0]}<em className="s">{t.hero.title[1]}</em>
            </h1>
            <p className="lede rise" style={{ animationDelay: '160ms' }}>
              {source === 'app-shared' ? t.hero.ledeShared : t.hero.lede}
            </p>
            <div className="ctas rise" style={{ animationDelay: '240ms' }}>
              <button type="button" onClick={() => goToSignup('hero')} className="btn p">{t.cta}</button>
              <a href="#demo" className="btn s">{t.hero.secondary}</a>
            </div>
          </div>
        </div>
      </section>

      <div className="trust">
        {t.trust.map((item) => <span key={item}>{item}</span>)}
      </div>

      {/* ─── COMMENT ÇA MARCHE ─────────────────────────────────────── */}
      <section id="comment" className="sec">
        <div className="wrap sec-in">
          <div className="head c" data-reveal>
            <span className="eyebrow">{t.how.eyebrow}</span>
            <h2 className="t-d2">{t.how.title[0]}<em className="s">{t.how.title[1]}</em></h2>
          </div>
          <div className="steps" data-reveal>
            <div className="card step">
              <span className="num">1</span>
              <div className="vis">
                <div className="node">
                  <span className="ph" style={{ backgroundImage: 'url(/hero/photos/jeanne-85.webp)' }} />
                  <span className="nm">Jeanne</span>
                  <span className="yr">1941</span>
                </div>
              </div>
              <h3 className="t-h3">{t.how.steps[0].title}</h3>
              <p className="t-small">{t.how.steps[0].text}</p>
            </div>
            <div className="card step">
              <span className="num">2</span>
              <div className="vis">
                <div className="voice" aria-hidden="true">
                  <b>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M5 3.5l8 4.5-8 4.5v-9Z" fill="currentColor" /></svg>
                  </b>
                  <span className="wave">{WAVE.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
                  <span>1:42</span>
                </div>
              </div>
              <h3 className="t-h3">{t.how.steps[1].title}</h3>
              <p className="t-small">{t.how.steps[1].text}</p>
            </div>
            <div className="card step">
              <span className="num">3</span>
              <div className="vis">
                <div className="toast"><b style={{ backgroundImage: 'url(/hero/photos/marc-56.webp)' }} />{t.how.toast}</div>
              </div>
              <h3 className="t-h3">{t.how.steps[2].title}</h3>
              <p className="t-small">{t.how.steps[2].text}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── DÉMO INLINE ────────────────────────────────────────────── */}
      <InlineDemo t={t} locale={locale} />

      {/* ─── POUR QUI ───────────────────────────────────────────────── */}
      <section className="sec">
        <div className="wrap sec-in">
          <div className="quote" data-reveal>
            <div className="head">
              <span className="eyebrow">{t.who.eyebrow}</span>
              <h2 className="t-d2">{t.who.title[0]}<em className="s">{t.who.title[1]}</em></h2>
              <p className="lede">{t.who.lede}</p>
            </div>
            <div className="gens" aria-hidden="true">
              <figure><div className="ph" style={{ '--s': 74, backgroundImage: 'url(/hero/photos/lya-14.webp)' }} /><figcaption>{t.who.captions[0]}</figcaption></figure>
              <figure><div className="ph" style={{ '--s': 96, backgroundImage: 'url(/hero/photos/camille-39.webp)' }} /><figcaption>{t.who.captions[1]}</figcaption></figure>
              <figure><div className="ph" style={{ '--s': 118, backgroundImage: 'url(/hero/photos/marc-56.webp)' }} /><figcaption>{t.who.captions[2]}</figcaption></figure>
              <figure><div className="ph" style={{ '--s': 140, backgroundImage: 'url(/hero/photos/jeanne-85.webp)' }} /><figcaption>{t.who.captions[3]}</figcaption></figure>
            </div>
          </div>

          <div className="promise" data-reveal>
            {t.promise.map(({ eyebrow, title, text }) => (
              <div key={eyebrow} className="card"><span className="eyebrow">{eyebrow}</span><h3 className="t-h2">{title}</h3><p className="t-small">{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── GUIDES ─────────────────────────────────────────────────── */}
      {t.guides && <section id="guides" className="sec" style={{ paddingTop: 0 }}>
        <div className="wrap sec-in">
          <div className="head c" data-reveal>
            <span className="eyebrow">{t.guides.eyebrow}</span>
            <h2 className="t-d2">{t.guides.title[0]}<em className="s">{t.guides.title[1]}</em></h2>
          </div>
          <div className="guides" data-reveal>
            {t.guides.items.map(({ href, title, text }) => (
              <a key={href} href={href} className="card guide">
                <h3 className="t-h2">{title}</h3>
                <p className="t-small">{text}</p>
                <span className="more">{t.guides.more}</span>
              </a>
            ))}
          </div>
        </div>
      </section>}

      {/* ─── CRÉER SON ARBRE ─────────────────────────────────────────── */}
      <section id="signup" className="final">
        <div className="wrap" data-reveal>
          <h2 className="t-d2">{t.final.title[0]}<em className="s">{t.final.title[1]}</em></h2>
          <p className="lede">{t.final.lede}</p>
          <button type="button" onClick={() => goToSignup('footer')} className="btn p">{t.cta}</button>
        </div>
      </section>

      </main>

      {/* ─── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="wrap foot">
        <Logo height={18} />
        <nav aria-label={t.footer.label}>
          {t.footer.guides && <a href="#guides">{t.footer.guides}</a>}
          <a href={withAppQuery(appLoginUrl(), locale)}>{t.footer.login}</a>
          <a href={t.privacyHref}>{t.footer.privacy}</a>
          <a href="https://github.com/IliesAllali/parenthese" rel="noopener noreferrer">{t.footer.source}</a>
          <a href="https://iliesallali.design/">{t.footer.madeBy}</a>
          <a href={t.otherLang.href} hrefLang={t.otherLang.hrefLang} lang={t.otherLang.hrefLang} title={t.otherLang.title}>{t.otherLang.label}</a>
        </nav>
      </footer>
    </div>
  )
}
