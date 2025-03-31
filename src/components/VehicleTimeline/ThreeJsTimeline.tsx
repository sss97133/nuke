/**
 * ThreeJsTimeline Component
 * 
 * This component uses Three.js to create an immersive 3D visualization of a vehicle's
 * complete lifecycle timeline from manufacture to present day, showing all key events.
 */
import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TimelineEvent } from './types';
import './VehicleTimeline.css';

interface ThreeJsTimelineProps {
  events: TimelineEvent[];
  loading: boolean;
  error: string | null;
  onEventClick?: (event: TimelineEvent) => void;
  manufactureDate: Date | null;
  className?: string;
}

const ThreeJsTimeline: React.FC<ThreeJsTimelineProps> = ({
  events,
  loading,
  error,
  onEventClick,
  manufactureDate,
  className
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const timelineGroupRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const eventMarkersRef = useRef<Map<string, THREE.Object3D>>(new Map());
  
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;
    
    // Create camera
    const camera = new THREE.PerspectiveCamera(
      45, 
      containerRef.current.clientWidth / containerRef.current.clientHeight, 
      0.1, 
      1000
    );
    camera.position.set(0, 5, 20);
    cameraRef.current = camera;
    
    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Add orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controlsRef.current = controls;
    
    // Create timeline group to hold all timeline elements
    const timelineGroup = new THREE.Group();
    scene.add(timelineGroup);
    timelineGroupRef.current = timelineGroup;
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    // Add event listener for window resize
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      
      rendererRef.current.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Add mouse event listeners for interaction
    const handleMouseMove = (event: MouseEvent) => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
    };
    
    const handleMouseClick = () => {
      if (hoveredEvent && onEventClick) {
        onEventClick(hoveredEvent);
        setSelectedEvent(hoveredEvent);
      }
    };
    
    containerRef.current.addEventListener('mousemove', handleMouseMove);
    containerRef.current.addEventListener('click', handleMouseClick);
    
    // Animation loop
    const animate = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;
      
      animationFrameRef.current = requestAnimationFrame(animate);
      
      // Update controls
      controlsRef.current.update();
      
      // Check for hover intersections
      if (cameraRef.current && events.length > 0 && eventMarkersRef.current.size > 0) {
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
        
        const intersects = raycasterRef.current.intersectObjects(
          Array.from(eventMarkersRef.current.values()), true
        );
        
        if (intersects.length > 0) {
          const object = intersects[0].object;
          const eventId = object.userData.eventId;
          
          if (eventId) {
            const event = events.find(e => e.id === eventId);
            if (event && (!hoveredEvent || hoveredEvent.id !== eventId)) {
              setHoveredEvent(event);
              document.body.style.cursor = 'pointer';
            }
          }
        } else {
          if (hoveredEvent) {
            setHoveredEvent(null);
            document.body.style.cursor = 'auto';
          }
        }
      }
      
      // Render scene
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    
    animate();
    
    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', handleMouseMove);
        containerRef.current.removeEventListener('click', handleMouseClick);
        
        if (rendererRef.current) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
      }
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);
  
  // Build or update timeline based on events data
  useEffect(() => {
    if (!sceneRef.current || !timelineGroupRef.current || !events.length) return;
    
    // Clear existing timeline
    while (timelineGroupRef.current.children.length > 0) {
      timelineGroupRef.current.remove(timelineGroupRef.current.children[0]);
    }
    
    eventMarkersRef.current.clear();
    
    // Get date range
    let startDate = manufactureDate || new Date();
    let endDate = new Date();
    
    if (events.length > 0) {
      const eventDates = events.map(e => new Date(e.eventDate));
      const earliestEventDate = new Date(Math.min(...eventDates.map(d => d.getTime())));
      const latestEventDate = new Date(Math.max(...eventDates.map(d => d.getTime())));
      
      if (!manufactureDate || earliestEventDate < manufactureDate) {
        startDate = earliestEventDate;
      }
      
      if (latestEventDate > endDate) {
        endDate = latestEventDate;
      }
    }
    
    // Add 10% padding to timeline start
    const timelineStartMs = startDate.getTime() - (endDate.getTime() - startDate.getTime()) * 0.1;
    startDate = new Date(timelineStartMs);
    
    // Add 10% padding to timeline end
    const timelineEndMs = endDate.getTime() + (endDate.getTime() - startDate.getTime()) * 0.1;
    endDate = new Date(timelineEndMs);
    
    // Create timeline base
    const timelineLength = 30; // Fixed visual length
    const timelineGeometry = new THREE.BoxGeometry(timelineLength, 0.1, 0.1);
    const timelineMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const timeline = new THREE.Mesh(timelineGeometry, timelineMaterial);
    timeline.castShadow = true;
    timeline.receiveShadow = true;
    timelineGroupRef.current.add(timeline);
    
    // Add major tick marks for years
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear() + 1; // Include the current year
    
    for (let year = startYear; year <= endYear; year++) {
      const yearDate = new Date(year, 0, 1);
      const position = getPositionOnTimeline(yearDate, startDate, endDate, timelineLength);
      
      // Create year marker
      const tickGeometry = new THREE.BoxGeometry(0.05, 0.5, 0.05);
      const tickMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
      const tick = new THREE.Mesh(tickGeometry, tickMaterial);
      tick.position.set(position - timelineLength / 2, 0.3, 0);
      tick.castShadow = true;
      tick.receiveShadow = true;
      timelineGroupRef.current.add(tick);
      
      // Add year label - use a canvas texture approach instead of TextGeometry
      // Create a canvas to draw text
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = 64;
      canvas.height = 32;
      
      if (context) {
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 24px Arial';
        context.fillStyle = 'black';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(year.toString(), canvas.width / 2, canvas.height / 2);
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      const labelMaterial = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true,
        side: THREE.DoubleSide
      });
      
      const labelGeometry = new THREE.PlaneGeometry(0.8, 0.4);
      const label = new THREE.Mesh(labelGeometry, labelMaterial);
      label.position.set(position - timelineLength / 2, 0.8, 0);
      label.rotation.x = -Math.PI / 2;
      timelineGroupRef.current.add(label);
    }
    
    // Add events to timeline
    events.forEach((event, index) => {
      const eventDate = new Date(event.eventDate);
      const position = getPositionOnTimeline(eventDate, startDate, endDate, timelineLength);
      
      // Create event marker
      const markerGeometry = new THREE.SphereGeometry(0.2, 32, 32);
      
      // Set color based on event type
      let markerColor;
      switch (event.eventType.toLowerCase()) {
        case 'manufacture':
        case 'built':
          markerColor = 0x4caf50; // Green
          break;
        case 'sale':
        case 'purchase':
          markerColor = 0x2196f3; // Blue
          break;
        case 'service':
        case 'maintenance':
          markerColor = 0xff9800; // Orange
          break;
        case 'listing':
          markerColor = 0x9c27b0; // Purple
          break;
        case 'modification':
          markerColor = 0xff5722; // Deep Orange
          break;
        case 'accident':
        case 'damage':
          markerColor = 0xf44336; // Red
          break;
        default:
          markerColor = 0x607d8b; // Blue Grey
      }
      
      const markerMaterial = new THREE.MeshStandardMaterial({ 
        color: markerColor,
        emissive: markerColor,
        emissiveIntensity: 0.2,
      });
      
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(position - timelineLength / 2, 0.2, 0);
      marker.castShadow = true;
      marker.receiveShadow = true;
      marker.userData.eventId = event.id;
      timelineGroupRef.current.add(marker);
      
      // Store reference to marker for raycasting
      eventMarkersRef.current.set(event.id, marker);
      
      // Create event line extending upward
      const lineHeight = 1.5 + (index % 3) * 0.5; // Stagger heights for better visibility
      const lineGeometry = new THREE.BoxGeometry(0.02, lineHeight, 0.02);
      const lineMaterial = new THREE.MeshStandardMaterial({ color: markerColor, transparent: true, opacity: 0.6 });
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.position.set(position - timelineLength / 2, lineHeight / 2, 0);
      timelineGroupRef.current.add(line);
      
      // If we have an image for this event, create a floating panel
      if (event.imageUrls && event.imageUrls.length > 0) {
        // This would require texture loading, which we'll mock for now
        const panelGeometry = new THREE.PlaneGeometry(1.5, 1);
        const panelMaterial = new THREE.MeshBasicMaterial({ 
          color: 0xffffff,
          side: THREE.DoubleSide 
        });
        
        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.position.set(position - timelineLength / 2, lineHeight + 0.5, 0);
        panel.userData.eventId = event.id;
        timelineGroupRef.current.add(panel);
        
        // Add to our tracked objects for raycasting
        eventMarkersRef.current.set(event.id + '_panel', panel);
      }
    });
    
    // Center timeline horizontally
    timelineGroupRef.current.position.set(0, 0, 0);
    
  }, [events, manufactureDate]);

  // Get position on timeline for a date
  const getPositionOnTimeline = (
    date: Date, 
    startDate: Date, 
    endDate: Date, 
    timelineLength: number
  ): number => {
    const totalDuration = endDate.getTime() - startDate.getTime();
    const eventTime = date.getTime() - startDate.getTime();
    const normalizedPosition = eventTime / totalDuration;
    
    return normalizedPosition * timelineLength;
  };
  
  // Display loading state
  if (loading) {
    return (
      <div className={`three-timeline ${className || ''}`}>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading timeline data...</p>
        </div>
      </div>
    );
  }
  
  // Display error state
  if (error) {
    return (
      <div className={`three-timeline ${className || ''}`}>
        <div className="error-container">
          <p>Error: {error}</p>
          <button className="retry-button">Retry</button>
        </div>
      </div>
    );
  }
  
  // Display empty state
  if (!events.length) {
    return (
      <div className={`three-timeline ${className || ''}`}>
        <div className="empty-container">
          <p>No timeline events found for this vehicle.</p>
          <p>Events will appear here as they are added to the vehicle's history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`three-timeline ${className || ''}`}>
      <div ref={containerRef} className="three-container"></div>
      
      {/* Hover tooltip */}
      {hoveredEvent && (
        <div 
          className="event-tooltip"
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <h4>{hoveredEvent.title}</h4>
          <p>{new Date(hoveredEvent.eventDate).toLocaleDateString()}</p>
          {hoveredEvent.description && <p>{hoveredEvent.description}</p>}
          <p>Source: {hoveredEvent.eventSource}</p>
          <p>Confidence: {hoveredEvent.confidenceScore}%</p>
        </div>
      )}
      
      {/* Event detail panel for selected event */}
      {selectedEvent && (
        <div className="event-detail-panel">
          <div className="panel-header">
            <h3>{selectedEvent.title}</h3>
            <button onClick={() => setSelectedEvent(null)}>×</button>
          </div>
          
          <div className="panel-content">
            <div className="event-metadata">
              <div className="metadata-item">
                <span className="label">Date:</span>
                <span className="value">{new Date(selectedEvent.eventDate).toLocaleDateString()}</span>
              </div>
              <div className="metadata-item">
                <span className="label">Type:</span>
                <span className="value">{selectedEvent.eventType}</span>
              </div>
              <div className="metadata-item">
                <span className="label">Source:</span>
                <span className="value">{selectedEvent.eventSource}</span>
              </div>
              <div className="metadata-item">
                <span className="label">Confidence:</span>
                <span className="value">{selectedEvent.confidenceScore}%</span>
              </div>
            </div>
            
            {selectedEvent.description && (
              <div className="event-description">
                <p>{selectedEvent.description}</p>
              </div>
            )}
            
            {selectedEvent.imageUrls && selectedEvent.imageUrls.length > 0 && (
              <div className="event-images">
                {selectedEvent.imageUrls.map((url, index) => (
                  <img 
                    key={index}
                    src={url}
                    alt={`${selectedEvent.title} - image ${index + 1}`}
                    className="event-image"
                  />
                ))}
              </div>
            )}
            
            {selectedEvent.sourceUrl && (
              <div className="event-source-link">
                <a 
                  href={selectedEvent.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Source
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThreeJsTimeline;
