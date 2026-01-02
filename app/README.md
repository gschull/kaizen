# kaiZEN Web App

A Progressive Web App (PWA) for personal continuous improvement, with group collaboration.

## Features

- 📱 **Works Offline** - Install as an app on any device
- 🎯 **Daily Focus** - Set and track your daily improvement goal
- ✅ **Habit Tracking** - Build positive habits with streaks
- 📔 **Reflection Journal** - Daily prompts for growth
- 🎯 **Goal Setting** - Personal and group goals with progress tracking
- 👥 **Groups** - Join/create a group to share goals and wins
- ⏱️ **Weekly Review Timer** - Guided 15-minute weekly review
- 📚 **Learn** - Kaizen principles and tips built-in

## Quick Start

### 1. Install Dependencies

```bash
cd app
npm install
```

### 2. Start the Server

```bash
npm start
```

### 3. Open in Browser

Visit [http://localhost:3000](http://localhost:3000)

### 4. Install as App

- **Chrome/Edge**: Click the install icon in the address bar
- **iOS Safari**: Tap Share → "Add to Home Screen"
- **Android Chrome**: Tap menu → "Add to Home Screen"

## Project Structure

```
app/
├── server.js           # Express server
├── package.json        # Dependencies
└── public/
    ├── index.html      # Main HTML
    ├── manifest.json   # PWA manifest
    ├── sw.js           # Service worker (offline support)
    ├── css/
    │   └── styles.css  # All styles
    ├── js/
    │   └── app.js      # Main application logic
    └── icons/
        └── icon.svg    # App icon
```

## Data Storage

The app stores identity/scope locally (via `localStorage`) and syncs goals/habits/wins/reflections to Firestore for realtime updates.

## Deployment Options

### Option 1: Vercel (Recommended - Free)

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the app directory
3. Follow the prompts

### Option 2: Netlify (Free)

1. Create a `netlify.toml` file:
```toml
[build]
  publish = "public"
  command = "echo 'No build needed'"
```
2. Drag and drop the `app` folder to [netlify.com/drop](https://netlify.com/drop)

### Option 3: GitHub Pages (Free)

1. Push to GitHub
2. Go to Settings → Pages
3. Select the `public` folder as source

### Option 4: Any Static Host

The `public` folder can be deployed to any static hosting service.

## Customization

### Colors

Edit CSS variables in `public/css/styles.css`:

```css
:root {
  --primary: #10b981;      /* Main green */
  --primary-dark: #059669;  /* Darker green */
  --secondary: #6366f1;     /* Purple accent */
  /* ... more colors */
}
```

### Meeting Steps

Edit `meetingSteps` in `public/js/app.js`:

```javascript
meetingSteps: [
  { name: 'Celebrations', duration: 180, icon: '🎉' },
  { name: 'Reflections', duration: 180, icon: '💭' },
  // ... customize times and steps
]
```

### Quotes

Add more quotes in `Dashboard.quotes` in `public/js/app.js`.

## Browser Support

- Chrome 60+
- Firefox 60+
- Safari 12+
- Edge 79+

## License

MIT License - Feel free to modify and share!

---

🌱 *Small steps, big results!*
