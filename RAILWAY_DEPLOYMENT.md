# 🚂 Railway Deployment Guide - DataFlix Subtitle Backend

## 📋 Prerequisites
- Railway.app account (free tier available)
- GitHub account
- This backend code in a Git repository

## 🚀 Deployment Steps

### 1. Push to GitHub
```bash
cd C:\Users\Administartor\subtitle-backend
git init
git add .
git commit -m "Initial commit - DataFlix subtitle backend"
git remote add origin https://github.com/YOUR_USERNAME/subtitle-backend.git
git push -u origin main
```

### 2. Deploy to Railway

1. **Go to Railway.app** → https://railway.app
2. **Click "Start a New Project"**
3. **Select "Deploy from GitHub repo"**
4. **Choose your `subtitle-backend` repository**
5. Railway will auto-detect Node.js and deploy!

### 3. Configure Environment Variables (Optional)

In Railway dashboard, go to **Variables** tab and add:

```env
PORT=3000
NODE_ENV=production
BACKEND_URL=https://your-app.railway.app
```

### 4. Get Your Railway URL

After deployment, Railway will give you a URL like:
```
https://subtitle-backend-production-xxxx.up.railway.app
```

## 🔗 Update Android App

Update `SubtitleService.kt`:

```kotlin
// OLD: http://10.0.2.2:3000
// NEW:
val backendUrl = "https://subtitle-backend-production-xxxx.up.railway.app/subtitles/$type/$videoId.json"
```

## 📊 Railway Features

✅ **Free Tier**: 500 hours/month  
✅ **Auto Deploy**: Every git push deploys automatically  
✅ **SSL**: HTTPS enabled by default  
✅ **Logs**: Real-time logs in dashboard  
✅ **Metrics**: CPU, Memory, Network monitoring  

## 🎯 Testing Deployment

Test your deployed backend:
```
https://your-railway-url.app/subtitles/series/tt3032476:1:1.json
```

Should return Turkish subtitles JSON!

## 🔧 Troubleshooting

**Port Issues**: Railway automatically sets `PORT` env variable
**Build Fails**: Check `package.json` has correct Node version
**504 Timeout**: Increase scraping timeout in `scraper.js`

## 💰 Cost

Railway Free Tier:
- ✅ 500 execution hours/month
- ✅ 100GB bandwidth
- ✅ 1GB RAM
- ✅ Unlimited projects

**Your subtitle backend will fit perfectly in free tier!** 🎉
