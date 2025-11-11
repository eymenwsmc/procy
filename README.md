# 🇹🇷 Turkcealtyazi Subtitle Backend

Backend API for scraping Turkish subtitles from turkcealtyazi.org

## 🚀 Kurulum

### 1. Dependencies yükle
```bash
cd subtitle-backend
npm install
```

### 2. Backend'i başlat
```bash
npm start
```

veya development mode:
```bash
npm run dev
```

Backend `http://localhost:3000` adresinde çalışacak.

## 📡 API Endpoints

### 1. **Subtitle Search**

**Filmler:**
```
GET /subtitles/movie/tt0111161.json
```

**Diziler:**
```
GET /subtitles/series/tt0903747:1:5.json
```
- Format: `imdbId:season:episode`

**Response:**
```json
{
  "subtitles": [
    {
      "id": "Movie.Name.2023.1080p.BluRay.srt",
      "url": "http://localhost:3000/download/12345-67890.zip",
      "lang": "tur"
    }
  ]
}
```

### 2. **Download Subtitle**

```
GET /download/12345-67890.zip
```

Returns the subtitle ZIP file.

### 3. **Cache Stats**

```
GET /cache/stats
```

### 4. **Clear Cache**

```
GET /cache/clear
```

## 🌐 Deploy (Production)

### Render.com (Ücretsiz)

1. [Render.com](https://render.com) hesabı oluştur
2. "New Web Service" → GitHub repo bağla
3. Environment variables:
   ```
   PORT=10000
   BACKEND_URL=https://your-app.onrender.com
   NODE_ENV=production
   ```
4. Deploy!

### Railway.app (Ücretsiz)

1. [Railway.app](https://railway.app) hesabı oluştur
2. "New Project" → GitHub repo
3. Environment variables ayarla
4. Deploy!

### Heroku

```bash
heroku create dataflix-subtitle-backend
git push heroku main
heroku config:set BACKEND_URL=https://dataflix-subtitle-backend.herokuapp.com
```

## 📱 Android Entegrasyonu

`SubtitleService.kt` dosyasında backend URL'ini değiştir:

```kotlin
val backendUrl = "https://your-backend-url.onrender.com/subtitles/$type/$videoId.json"
```

## ⚠️ Önemli Notlar

- Turkcealtyazi.org CloudFlare koruması kullanıyor
- Yurtdışı IP'lerden erişim sınırlı olabilir
- Rate limiting: 50 request / 15 dakika
- Cache: 15 dakika (başarılı), 2 dakika (boş sonuç)

## 🔧 Troubleshooting

### "Cannot access turkcealtyazi.org"
- Türkiye'den proxy kullanın
- VPN ile deneyin

### "Too many requests"
- Rate limit aşıldı, 15 dakika bekleyin
- Cache temizleyin: `/cache/clear`

## 📝 License

MIT
