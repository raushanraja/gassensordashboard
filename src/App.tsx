import "./app.css";
import { useState, useEffect, useMemo, useRef } from 'react';

/** * TYPE DEFINITIONS
 */

interface DataPoint {
  timestamp: Date;
  value: number;
}

interface HoveredPoint extends DataPoint {
  x: number;
  y: number;
}

interface Config {
  supabaseUrl: string;
  apiKey: string;
  sensorId: string;
  tableName: string;
  refreshRate: number;
}

interface DeviceInfo {
  rssi: number | null;
  device: string | null;
  uptime: number | null;
}

interface SmoothLineChartProps {
  data: DataPoint[];
  color?: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config;
  onSave: (config: Config) => void;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: string;
  iconColor: string;
  subtext: string;
  statusColor?: string;
}

interface SupabaseReading {
  recorded_at: string;
  raw_value: number;
  metadata?: {
    rssi: number;
    device: string;
    uptime_s: number;
  };
}

/** * UTILITIES & CONFIGURATION
 */

// Inject FontAwesome CDN
const useFontAwesome = () => {
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);
};

// Mock Data Generator
const generateMockData = (points = 24) => {
  const data = [];
  const now = new Date();
  for (let i = 0; i < points; i++) {
    const time = new Date(now.getTime() - (points - 1 - i) * 3600000); // 1 hour intervals
    // Create a somewhat realistic gas curve with some noise
    const base = 1200;
    const spike = Math.random() > 0.8 ? 1000 : 0;
    const value = Math.floor(base + Math.sin(i * 0.5) * 400 + Math.random() * 200 + spike);
    data.push({
      timestamp: time,
      value: Math.max(0, Math.min(4095, value)), // Clamp 0-4095
    });
  }
  return data;
};

// Format seconds to HH:MM:SS
const formatUptime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * COMPONENTS
 */

// 1. Custom Responsive SVG Chart
const SmoothLineChart = ({ data, color = "#6366f1" }: SmoothLineChartProps) => {
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 300 });
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const lastTouchDistanceRef = useRef<number | null>(null);
  const lastPanXRef = useRef<number | null>(null);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: 300,
        });
      }
    };
    
    // Use ResizeObserver for more reliable sizing
    const resizeObserver = new ResizeObserver(handleResize);
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      handleResize(); // Initial call
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [data]); // Re-calculate when data changes

  if (!data || data.length === 0) return <div className="h-64 flex items-center justify-center text-slate-500">No Data</div>;

  // Scales
  const padding = 20;
  const graphWidth = dimensions.width;
  const graphHeight = dimensions.height;
  const maxVal = 4095; // ADC max
  const minVal = 0;

  // Apply zoom and pan
  const zoomedWidth = graphWidth * zoom;
  const maxPanOffset = Math.max(0, (zoomedWidth - graphWidth) / 2);
  const clampedPanOffset = Math.max(-maxPanOffset, Math.min(maxPanOffset, panOffset));

  const getX = (index: number) => {
    const baseX = (index / (data.length - 1)) * (zoomedWidth - padding * 2) + padding;
    return baseX - clampedPanOffset;
  };
  const getY = (val: number) => graphHeight - ((val - minVal) / (maxVal - minVal)) * (graphHeight - padding * 2) - padding;

  // Generate Path (Catmull-Rom or simple Bezier for smoothness)
  // For simplicity and stability, we'll use a simple line or quadratic helper
  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');

  // Interactive overlay logic
  const updateHoveredPoint = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    
    // Find closest data point accounting for zoom and pan
    const adjustedX = x + clampedPanOffset;
    const index = Math.round(((adjustedX - padding) / (zoomedWidth - padding * 2)) * (data.length - 1));
    if (index >= 0 && index < data.length) {
      const pointX = getX(index);
      // Only show if point is visible
      if (pointX >= 0 && pointX <= graphWidth) {
        setHoveredPoint({ ...data[index], x: pointX, y: getY(data[index].value) });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    updateHoveredPoint(e.clientX);
  };

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    if (e.touches.length === 2) {
      // Pinch to zoom
      const currentDistance = getTouchDistance(e.touches);
      if (currentDistance && lastTouchDistanceRef.current) {
        const scale = currentDistance / lastTouchDistanceRef.current;
        setZoom(prev => Math.max(1, Math.min(5, prev * scale)));
      }
      lastTouchDistanceRef.current = currentDistance;
    } else if (e.touches.length === 1) {
      if (zoom > 1 && lastPanXRef.current !== null) {
        // Pan when zoomed
        const deltaX = e.touches[0].clientX - lastPanXRef.current;
        setPanOffset(prev => prev - deltaX);
      } else {
        // Show value on single touch
        updateHoveredPoint(e.touches[0].clientX);
      }
      lastPanXRef.current = e.touches[0].clientX;
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      lastTouchDistanceRef.current = getTouchDistance(e.touches);
    } else if (e.touches.length === 1) {
      lastPanXRef.current = e.touches[0].clientX;
      updateHoveredPoint(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistanceRef.current = null;
    lastPanXRef.current = null;
    setHoveredPoint(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(1, Math.min(5, prev * zoomDelta)));
  };

  const resetZoom = () => {
    setZoom(1);
    setPanOffset(0);
  };

  return (
    <div className="relative">
      <div 
        ref={containerRef} 
        className="relative w-full select-none cursor-crosshair overflow-hidden rounded-xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm touch-none"
        style={{ height: `${dimensions.height}px` }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
      <svg width={dimensions.width} height={dimensions.height} className="absolute inset-0">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {/* Grid Lines */}
        {[0, 1024, 2048, 3072, 4095].map((val) => (
          <line 
            key={val}
            x1={0} 
            y1={getY(val)} 
            x2={dimensions.width} 
            y2={getY(val)} 
            stroke="#334155" 
            strokeWidth="1" 
            strokeDasharray="4 4"
          />
        ))}

        {/* Area Fill */}
        <path d={`M${points.split(' ')[0]} L${points.replace(/,/g, ' ')}`} fill="none" className="hidden" /> {/* Dummy for logic check */}
        <path d={`M${points.split(' ')[0]} L${points.replace(/,/g, ' ')} L${getX(data.length-1)},${graphHeight} L${getX(0)},${graphHeight} Z`} fill="url(#chartGradient)" />

        {/* The Line */}
        <polyline 
          points={points} 
          fill="none" 
          stroke={color} 
          strokeWidth="3" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />

        {/* Hover Indicator */}
        {hoveredPoint && (
          <>
            <line 
              x1={hoveredPoint.x} 
              y1={padding} 
              x2={hoveredPoint.x} 
              y2={graphHeight - padding} 
              stroke="white" 
              strokeOpacity="0.5" 
              strokeDasharray="3 3"
            />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="6" fill={color} stroke="white" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div 
          className="absolute z-10 pointer-events-none bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl transform -translate-x-1/2 -translate-y-full"
          style={{ left: hoveredPoint.x, top: hoveredPoint.y - 10 }}
        >
          <div className="text-xs text-slate-400 mb-1">
            {hoveredPoint.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </div>
          <div className="font-bold text-lg text-white">
            {hoveredPoint.value} <span className="text-xs font-normal text-slate-400">ADC</span>
          </div>
        </div>
      )}
    </div>
    
    {/* Zoom Controls */}
    {zoom > 1 && (
      <div className="mt-2 flex items-center justify-center gap-2">
        <button
          onClick={resetZoom}
          className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors flex items-center gap-1"
        >
          <i className="fa-solid fa-compress"></i>
          Reset Zoom ({zoom.toFixed(1)}x)
        </button>
      </div>
    )}
  </div>
  );
};

// 2. Settings Modal
const SettingsModal = ({ isOpen, onClose, config, onSave }: SettingsModalProps) => {
  const [formData, setFormData] = useState<Config>(config);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    // Only reset form data when modal transitions from closed to open
    if (isOpen && !prevIsOpenRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData(config);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, config]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: Config) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    // Simulate API validation delay
    setTimeout(() => {
      onSave(formData);
      setIsSaving(false);
      onClose();
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
              <i className="fa-solid fa-gear text-lg"></i>
            </div>
            <h2 className="text-xl font-bold text-white">Configuration</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            
            {/* Supabase URL */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Supabase URL</label>
              <div className="relative">
                <i className="fa-solid fa-link absolute left-3 top-3.5 text-slate-500"></i>
                <input 
                  type="text" 
                  name="supabaseUrl"
                  value={formData.supabaseUrl} 
                  onChange={handleChange}
                  placeholder="https://xyz.supabase.co"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder-slate-600"
                />
              </div>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">API Key</label>
              <div className="relative">
                <i className="fa-solid fa-key absolute left-3 top-3.5 text-slate-500"></i>
                <input 
                  type={showKey ? "text" : "password"} 
                  name="apiKey"
                  value={formData.apiKey} 
                  onChange={handleChange}
                  placeholder="your-anon-key"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 pl-10 pr-12 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder-slate-600"
                />
                <button 
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-3 text-slate-500 hover:text-slate-300"
                >
                  <i className={`fa-solid ${showKey ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {/* Grid Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Sensor ID */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Sensor ID</label>
                <input 
                  type="text" 
                  name="sensorId"
                  value={formData.sensorId} 
                  onChange={handleChange}
                  placeholder="UUID-..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
              
              {/* Table Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Table Name</label>
                <input 
                  type="text" 
                  name="tableName"
                  value={formData.tableName} 
                  onChange={handleChange}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Refresh Interval Slider */}
            <div className="pt-2">
              <div className="flex justify-between mb-2">
                 <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Refresh Interval</label>
                 <span className="text-sm font-bold text-blue-400">{formData.refreshRate}s</span>
              </div>
              <input 
                type="range" 
                name="refreshRate"
                min="5" 
                max="300" 
                step="5"
                value={formData.refreshRate} 
                onChange={handleChange}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>
            
            {/* Help Block */}
            <div className="bg-slate-800/50 rounded-lg p-4 flex gap-3 border border-slate-700/50">
              <i className="fa-solid fa-circle-info text-blue-400 mt-1"></i>
              <div className="text-sm text-slate-400 leading-relaxed">
                <p className="mb-2"><strong className="text-slate-300">Security Note:</strong> Settings are saved to your browser's <code className="bg-slate-700 px-1 rounded text-xs">localStorage</code>. Do not use on public computers.</p>
                <p>Ensure your Supabase RLS policies allow reading from the specified table for anonymous users.</p>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex flex-col md:flex-row gap-3 justify-end">
          <button 
            type="button" 
            className="px-4 py-3 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-800 transition-colors"
          >
            Test Connection
          </button>
           <button 
            type="button" 
            onClick={() => {
                if(window.confirm("Are you sure you want to clear all settings?")) {
                    setFormData({supabaseUrl: '', apiKey: '', sensorId: '', tableName: 'sensor_readings', refreshRate: 10});
                }
            }}
            className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-medium hover:bg-red-500/20 transition-colors"
          >
            Clear
          </button>
          <button 
            onClick={handleSubmit}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-lg hover:shadow-indigo-500/30 transform hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
          >
            {isSaving ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-save"></i>}
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
};

// 3. Stat Card
const StatCard = ({ title, value, icon, iconColor, subtext, statusColor }: StatCardProps) => (
  <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-slate-600 transition-all">
    <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500`}>
        <i className={`fa-solid ${icon} text-6xl ${iconColor}`}></i>
    </div>
    <div className="relative z-10">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg ${statusColor || 'bg-slate-700'} bg-opacity-20 flex items-center justify-center`}>
            <i className={`fa-solid ${icon} ${iconColor}`}></i>
        </div>
        <span className="text-slate-400 text-sm font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="text-3xl font-bold text-white mb-1 tracking-tight">{value}</div>
      {subtext && <div className="text-xs font-medium text-slate-500">{subtext}</div>}
    </div>
  </div>
);

/**
 * MAIN APP
 */
const App = () => {
  useFontAwesome();

  // State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState({
    supabaseUrl: '',
    apiKey: '',
    sensorId: 'a1b2-c3d4-e5f6',
    tableName: 'sensor_readings',
    refreshRate: 5
  });
  
  const [data, setData] = useState<DataPoint[]>([]);
  const [timeRange, setTimeRange] = useState('24H');
  const [lastUpdated, setLastUpdated] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({ rssi: null, device: null, uptime: null });

  // Fetch data from Supabase
  const fetchSupabaseData = async (isInitialLoad = false) => {
    if (!config.supabaseUrl || !config.apiKey || !config.sensorId) {
      setError('Please configure Supabase settings first');
      setIsConfigured(false);
      return;
    }

    setIsConfigured(true);
    setIsLoading(true);
    setError(null);

    try {
      // Calculate time range
      const now = new Date();
      const hoursMap = { '1H': 1, '6H': 6, '24H': 24, '7D': 168 };
      const hours = hoursMap[timeRange as keyof typeof hoursMap] || 24;
      const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

      let allReadings: SupabaseReading[] = [];

      // On refresh, only fetch new data since last timestamp
      if (!isInitialLoad && data.length > 0) {
        const lastTimestamp = data[data.length - 1].timestamp;
        const lastISO = lastTimestamp.toISOString();
        const query = `${config.tableName}?sensor_id=eq.${config.sensorId}&recorded_at=gt.${lastISO}&order=recorded_at.asc`;
        const url = `${config.supabaseUrl}/rest/v1/${query}`;
        
        const response = await fetch(url, {
          headers: {
            'apikey': config.apiKey,
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        allReadings = await response.json();
      } else {
        // Initial load - fetch full time range with pagination
        const startISO = startTime.toISOString();
        const pageSize = 1000;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const query = `${config.tableName}?sensor_id=eq.${config.sensorId}&recorded_at=gte.${startISO}&order=recorded_at.asc&limit=${pageSize}&offset=${offset}`;
          const url = `${config.supabaseUrl}/rest/v1/${query}`;
          
          const response = await fetch(url, {
            headers: {
              'apikey': config.apiKey,
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'count=exact'
            }
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const readings = await response.json();
          allReadings.push(...readings);
          
          // Check if there are more pages
          if (readings.length < pageSize) {
            hasMore = false;
          } else {
            offset += pageSize;
          }
        }
      }

      if (allReadings && allReadings.length > 0) {
        const formattedData = allReadings.map((r: SupabaseReading) => ({
          timestamp: new Date(r.recorded_at),
          value: r.raw_value
        }));

        // Extract device metadata from latest reading
        const latestReading = allReadings[allReadings.length - 1];
        if (latestReading.metadata) {
          setDeviceInfo({
            rssi: latestReading.metadata.rssi,
            device: latestReading.metadata.device,
            uptime: latestReading.metadata.uptime_s
          });
        }

        if (isInitialLoad || data.length === 0) {
          // Initial load - replace all data
          setData(formattedData);
        } else {
          // Append new data and trim old data outside time range
          const combined = [...data, ...formattedData];
          const cutoffTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
          const filtered = combined.filter(d => d.timestamp >= cutoffTime);
          setData(filtered);
        }
        setError(null);
      } else if (isInitialLoad) {
        setError('No data available for selected time range');
        setData([]);
      }
      // On refresh with no new data, keep existing data
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      // Keep existing data on error
    } finally {
      setIsLoading(false);
    }
  };

  // Load Config on Mount
  useEffect(() => {
    const savedConfig = localStorage.getItem('gas_sensor_config');
    if (savedConfig) {
      const loaded = JSON.parse(savedConfig);
      setConfig(loaded);
      // Check if properly configured
      if (loaded.supabaseUrl && loaded.apiKey && loaded.sensorId) {
        setIsConfigured(true);
      }
    } else {
      // Show mock data if not configured
      setData(generateMockData(24));
    }
  }, []);

  // Fetch data when configured or time range changes
  useEffect(() => {
    if (isConfigured && config.supabaseUrl && config.apiKey && config.sensorId) {
      fetchSupabaseData(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, timeRange, isConfigured]);

  // Auto-refresh data based on refresh rate
  useEffect(() => {
    if (!isConfigured || !config.supabaseUrl) return;

    const interval = setInterval(() => {
      fetchSupabaseData(false);
    }, config.refreshRate * 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.refreshRate, isConfigured, timeRange, data]);

  // Simulate Real-time Updates (only for mock data)
  useEffect(() => {
    if (isConfigured) return; // Skip if using real data
    const interval = setInterval(() => {
        setLastUpdated(prev => prev + 1);
        
        // Every 5 seconds (simulating refresh rate), add a new point
        if (lastUpdated > 0 && lastUpdated % config.refreshRate === 0) {
            setData(prevData => {
                const lastVal = prevData[prevData.length - 1].value;
                // Random walk
                const change = Math.floor(Math.random() * 100) - 50;
                const newVal = Math.max(0, Math.min(4095, lastVal + change));
                
                const newPoint = {
                    timestamp: new Date(),
                    value: newVal
                };
                
                const newData = [...prevData.slice(1), newPoint]; // Keep window fixed
                return newData;
            });
            setLastUpdated(0);
        }

    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.refreshRate, lastUpdated]);

  const saveSettings = (newConfig: Config) => {
    setConfig(newConfig);
    localStorage.setItem('gas_sensor_config', JSON.stringify(newConfig));
  };

  // Derived Statistics
  const stats = useMemo(() => {
    if (!data.length) return { min: 0, max: 0, avg: 0, current: 0 };
    const values = data.map(d => d.value).filter(v => v != null);
    if (values.length === 0) return { min: 0, max: 0, avg: 0, current: 0 };
    const sum = values.reduce((a, b) => a + b, 0);
    const current = values[values.length - 1] || 0;
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Math.round(sum / values.length),
      current
    };
  }, [data]);

  // Status Logic
  const isDanger = stats.current > 2000;
  const statusText = isDanger ? "GAS DETECTED" : "NORMAL";
  const statusColor = isDanger ? "text-red-500" : "text-emerald-400";
  const mainGradient = isDanger ? "from-red-500 to-orange-600" : "from-emerald-400 to-cyan-500";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${mainGradient} flex items-center justify-center shadow-lg shadow-blue-900/20`}>
                <i className="fa-solid fa-fire text-white text-lg"></i>
             </div>
             <div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                  Gas Sensor Dashboard
                </h1>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    {isLoading ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin text-blue-400"></i>
                        <span className="text-blue-400">Syncing...</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        <span>Live Monitoring</span>
                      </>
                    )}
                </div>
             </div>
          </div>
          
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="w-10 h-10 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all shadow-lg active:scale-95"
          >
            <i className="fa-solid fa-gear"></i>
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
            <i className="fa-solid fa-triangle-exclamation text-red-400 text-xl"></i>
            <div>
              <div className="text-red-400 font-bold">Connection Error</div>
              <div className="text-red-300 text-sm">{error}</div>
            </div>
            <button 
              onClick={() => fetchSupabaseData(true)}
              className="ml-auto px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Not Configured Warning */}
        {!isConfigured && !error && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 flex items-center gap-3">
            <i className="fa-solid fa-circle-info text-orange-400 text-xl"></i>
            <div className="flex-1">
              <div className="text-orange-400 font-bold">Configuration Required</div>
              <div className="text-orange-300 text-sm">Please configure your Supabase settings to view live data. Currently showing mock data.</div>
            </div>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 rounded-lg text-orange-300 text-sm font-medium transition-colors"
            >
              Configure
            </button>
          </div>
        )}

        {/* STATS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Current Reading */}
          <StatCard 
            title="Current Level" 
            value={stats.current}
            icon="fa-gauge-high"
            iconColor={isDanger ? "text-red-500" : "text-blue-500"}
            subtext="ADC Value (0-4095)"
            statusColor="bg-slate-700"
          />

          {/* Status */}
          <div className={`bg-slate-800 border-2 ${isDanger ? 'border-red-500/50' : 'border-emerald-500/50'} rounded-2xl p-5 shadow-lg relative overflow-hidden flex flex-col justify-center`}>
              <div className="flex items-center gap-3 mb-2">
                 <i className={`fa-solid ${isDanger ? 'fa-triangle-exclamation' : 'fa-shield-check'} text-2xl ${statusColor}`}></i>
                 <span className={`text-xl font-black tracking-widest ${statusColor}`}>{statusText}</span>
              </div>
              <div className="text-xs text-slate-400">
                 Threshold: 2000 ADC
              </div>
              {/* Background Pulse Effect */}
              {isDanger && <div className="absolute inset-0 bg-red-500/10 animate-pulse"></div>}
          </div>

          {/* Last Updated */}
          <StatCard 
            title="Last Updated" 
            value={data.length > 0 ? new Date(data[data.length - 1].timestamp).toLocaleTimeString() : '--'}
            icon="fa-clock"
            iconColor="text-orange-400"
            subtext={`Refresh Rate: ${config.refreshRate}s`}
            statusColor="bg-slate-700"
          />

           {/* RSSI */}
           <StatCard 
            title={deviceInfo.device ? `Device: ${deviceInfo.device}` : "Device RSSI"}
            value={deviceInfo.rssi ? `${deviceInfo.rssi} dBm` : '--'}
            icon="fa-wifi"
            iconColor={deviceInfo.rssi ? (deviceInfo.rssi > -60 ? "text-green-400" : deviceInfo.rssi > -70 ? "text-yellow-400" : deviceInfo.rssi > -80 ? "text-orange-400" : "text-red-400") : "text-purple-400"}
            subtext={deviceInfo.rssi ? `Signal: ${deviceInfo.rssi > -60 ? 'Excellent' : deviceInfo.rssi > -70 ? 'Good' : deviceInfo.rssi > -80 ? 'Fair' : 'Poor'}${deviceInfo.uptime ? ` • Uptime: ${formatUptime(deviceInfo.uptime)}` : ''}` : 'No data'}
            statusColor="bg-slate-700"
          />

        </div>

        {/* CHART SECTION */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
           
           <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <div>
                 <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <i className="fa-solid fa-chart-line text-blue-500"></i>
                    Sensor Trends
                 </h2>
                 <p className="text-sm text-slate-500">Historical data analysis over time</p>
              </div>

              {/* Time Range Selectors */}
              <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{data.length} points</span>
                  <div className="flex bg-slate-800 p-1 rounded-lg">
                      {['1H', '6H', '24H', '7D'].map((range) => (
                          <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                                timeRange === range 
                                ? 'bg-blue-600 text-white shadow-md' 
                                : 'text-slate-400 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                              {range}
                          </button>
                      ))}
                  </div>
              </div>
           </div>

           {/* The Chart */}
           <div className="w-full">
              <SmoothLineChart data={data} color={isDanger ? '#ef4444' : '#6366f1'} />
           </div>

        </div>

        {/* STATISTICS SUMMARY PANEL */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Min */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between group hover:border-blue-500/30 transition-colors">
                <div>
                    <div className="text-slate-500 text-xs font-bold uppercase mb-1">Period Min</div>
                    <div className="text-2xl font-mono text-white">{stats.min}</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-emerald-400">
                    <i className="fa-solid fa-arrow-down"></i>
                </div>
            </div>

            {/* Max */}
             <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between group hover:border-blue-500/30 transition-colors">
                <div>
                    <div className="text-slate-500 text-xs font-bold uppercase mb-1">Period Max</div>
                    <div className="text-2xl font-mono text-white">{stats.max}</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-red-400">
                    <i className="fa-solid fa-arrow-up"></i>
                </div>
            </div>

            {/* Avg */}
             <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between group hover:border-blue-500/30 transition-colors">
                <div>
                    <div className="text-slate-500 text-xs font-bold uppercase mb-1">Average</div>
                    <div className="text-2xl font-mono text-white">{stats.avg}</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-blue-400">
                    <i className="fa-solid fa-calculator"></i>
                </div>
            </div>

        </div>

      </main>

      {/* SETTINGS POPUP */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        config={config}
        onSave={saveSettings}
      />

    </div>
  );
};

export default App;