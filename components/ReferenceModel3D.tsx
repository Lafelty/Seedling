'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useRef, useState, useEffect } from 'react'
import * as THREE from 'three'

function SkeletonModel() {
  const groupRef = useRef<THREE.Group>(null)

  // Define the target pose (arms raised above shoulders)
  // Using a simplified skeleton with key joints
  const joints = {
    // Torso center
    spine: [0, 0, 0],

    // Shoulders
    leftShoulder: [-0.4, 0, 0],
    rightShoulder: [0.4, 0, 0],

    // Arms raised above shoulders (target pose)
    leftElbow: [-0.4, 0.5, 0],
    rightElbow: [0.4, 0.5, 0],

    leftWrist: [-0.4, 1.0, 0],
    rightWrist: [0.4, 1.0, 0],
  }

  const connections = [
    // Shoulder line
    [joints.leftShoulder, joints.rightShoulder, '#C4612F'],
    // Left arm
    [joints.leftShoulder, joints.leftElbow, '#C4612F'],
    [joints.leftElbow, joints.leftWrist, '#C4612F'],
    // Right arm
    [joints.rightShoulder, joints.rightElbow, '#C4612F'],
    [joints.rightElbow, joints.rightWrist, '#C4612F'],
  ]

  return (
    <group ref={groupRef}>
      {/* Draw bones as cylinders */}
      {connections.map(([start, end, color], i) => {
        const startVec = new THREE.Vector3(...(start as [number, number, number]))
        const endVec = new THREE.Vector3(...(end as [number, number, number]))
        const direction = new THREE.Vector3().subVectors(endVec, startVec)
        const length = direction.length()
        const midpoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5)

        // Calculate rotation to align cylinder with the bone
        const axis = new THREE.Vector3(0, 1, 0)
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          axis,
          direction.clone().normalize()
        )

        return (
          <mesh key={i} position={midpoint} quaternion={quaternion}>
            <cylinderGeometry args={[0.04, 0.04, length, 8]} />
            <meshStandardMaterial color={color as string} />
          </mesh>
        )
      })}

      {/* Draw joints as spheres */}
      {Object.values(joints).map((pos, i) => (
        <mesh key={`joint-${i}`} position={pos as [number, number, number]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color="#A94E22" />
        </mesh>
      ))}

      {/* Add a subtle arrow pointing up to emphasize the target direction */}
      <group position={[0, 1.3, 0]}>
        <mesh rotation={[0, 0, 0]}>
          <coneGeometry args={[0.08, 0.15, 8]} />
          <meshStandardMaterial color="#5C635D" opacity={0.6} transparent />
        </mesh>
      </group>
    </group>
  )
}

export default function ReferenceModel3D() {
  const [size, setSize] = useState({ width: 200, height: 280 })
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle dragging
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      setPosition({ x: position.x + dx, y: position.y + dy })
      setDragStart({ x: e.clientX, y: e.clientY })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStart, position])

  // Handle resizing
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStart.x
      const dy = e.clientY - resizeStart.y
      const newWidth = Math.max(150, resizeStart.width + dx)
      const newHeight = Math.max(200, resizeStart.height + dy)
      setSize({ width: newWidth, height: newHeight })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, resizeStart])

  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsResizing(true)
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    })
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: `${size.width}px`,
        height: `${size.height}px`,
        transform: `translate(${position.x}px, ${position.y}px)`,
        position: 'relative',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '2px solid var(--border)',
        cursor: isDragging ? 'grabbing' : 'auto',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: 'var(--space-3)',
          borderBottom: '1px solid var(--border)',
          textAlign: 'center',
          cursor: 'grab',
          userSelect: 'none',
          background: isDragging ? 'rgba(196, 97, 47, 0.05)' : 'transparent',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
            <circle cx="9" cy="6" r="1" fill="var(--muted)" />
            <circle cx="15" cy="6" r="1" fill="var(--muted)" />
            <circle cx="9" cy="12" r="1" fill="var(--muted)" />
            <circle cx="15" cy="12" r="1" fill="var(--muted)" />
            <circle cx="9" cy="18" r="1" fill="var(--muted)" />
            <circle cx="15" cy="18" r="1" fill="var(--muted)" />
          </svg>
          <p style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--ink)',
            fontFamily: 'var(--font-display)',
          }}>
            Target Position
          </p>
        </div>
      </div>

      <Canvas
        camera={{ position: [0, 0.5, 2.5], fov: 50 }}
        style={{ background: 'transparent', height: `${size.height - 80}px` }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />

        <SkeletonModel />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 1.5}
          autoRotate
          autoRotateSpeed={1.5}
        />
      </Canvas>

      <div style={{
        padding: 'var(--space-2)',
        borderTop: '1px solid var(--border)',
        textAlign: 'center',
      }}>
        <p style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--muted)',
        }}>
          Drag to rotate
        </p>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '24px',
          height: '24px',
          cursor: 'nwse-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
          <path d="M21 15l-6 6M21 8l-13 13" />
        </svg>
      </div>
    </div>
  )
}
