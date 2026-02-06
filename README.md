# Gas Sensor Dashboard - Web UI

A modern, responsive real-time dashboard for monitoring gas sensor data from IoT devices. Built with React, TypeScript, and Vite.

## Features

- **📊 Real-time Monitoring** - Live gas sensor readings with auto-refresh
- **📈 Interactive Charts** - Smooth SVG line charts with hover tooltips
- **⚡ Incremental Data Fetching** - Efficient bandwidth usage (only fetches new data)
- **🎨 Modern UI** - Dark theme with TailwindCSS and Font Awesome icons
- **📱 Responsive Design** - Works on desktop, tablet, and mobile
- **⚙️ Configurable** - No hardcoded credentials, all settings in browser localStorage
- **🔔 Alert System** - Visual and color-coded gas detection warnings
- **📡 Device Status** - RSSI signal strength, device name, and uptime display

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast development and build tooling
- **TailwindCSS** - Utility-first CSS framework
- **Font Awesome 6.4** - Icon library
- **Supabase** - Backend database (PostgREST API)

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (or npm/yarn)

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

### First-Time Setup

1. Open the dashboard in your browser (typically `http://localhost:5173`)
2. Click the **gear icon** in the top-right corner
3. Configure your Supabase connection:
   - **Supabase URL**: Your project URL (e.g., `https://xyz.supabase.co`)
   - **API Key**: Your anon/public key (NOT service role key)
   - **Sensor ID**: Your device UUID
   - **Table Name**: Database table name (default: `sensor_readings`)
   - **Refresh Interval**: Auto-refresh rate in seconds (5-300s)
4. Click **Save Configuration**

### Database Schema

Expected table structure:

```sql
CREATE TABLE sensor_readings (
  id UUID PRIMARY KEY,
  sensor_id UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  raw_value INTEGER NOT NULL,
  metadata JSONB, -- { rssi: -89, device: "esp32-c3", uptime_s: 2442 }
  calibrated_value FLOAT,
  on_off BOOLEAN
);
```

## Features in Detail

### Time Range Selection
Choose from preset time ranges:
- **1H** - Last 1 hour
- **6H** - Last 6 hours  
- **24H** - Last 24 hours
- **7D** - Last 7 days

### Statistics Dashboard
- **Current Level** - Latest ADC reading (0-4095)
- **Status** - GAS DETECTED / NORMAL (threshold: 2000 ADC)
- **Last Updated** - Timestamp of most recent reading
- **Device Info** - RSSI signal strength with quality indicator and uptime

### Incremental Fetching
- **Initial Load**: Fetches full time range using `gte` (greater than or equal)
- **Auto-Refresh**: Fetches only new data using `gt` (greater than) last timestamp
- **Smart Trimming**: Removes old data outside selected time window
- Significantly reduces bandwidth and API calls

## Security Notes

⚠️ **Important**: 
- Settings are stored in browser `localStorage`
- Do not use on public/shared computers
- Use only Supabase **anon/public keys** (not service role keys)
- Configure Row Level Security (RLS) policies on Supabase

## Configuration

### Hardcoded Values
- ADC Range: 0-4095
- Gas Detection Threshold: 2000 ADC
- Refresh Rate Limits: 5-300 seconds
- Chart Grid Lines: [0, 1024, 2048, 3072, 4095]

### Customization
To modify the gas threshold, edit `App.tsx`:
```typescript
const isDanger = stats.current > 2000; // Change this value
```

## Build Output

```bash
pnpm build
```

Creates optimized production build in `dist/` directory. Deploy to:
- Vercel
- Netlify
- GitHub Pages
- Any static hosting service

## Development

Built with Vite + React Fast Refresh for instant hot module replacement (HMR).

```bash
# Development with HMR
pnpm dev

# Type checking
pnpm tsc

# Linting
pnpm lint
```

## License

Part of the Gas Sensor IoT project.
# gassensordashboard
