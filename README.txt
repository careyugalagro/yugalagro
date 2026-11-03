YUGAL AGRO - WEBSITE FILES
==========================
index.html     -> poori website (ek hi file)
videos/        -> hero ke 5 background videos (milk, paneer, ghee, dal, vermicompost) + poster photos
images/        -> saari photos. Jis photo ko badalna ho, usi naam se nayi photo daal dein
                  (e.g. images/milk.jpg). Best: 1200x1200 JPG, saaf background.
                  hero.jpg = upar ki badi photo (1600x700 jaisi wide), cat-*.jpg = gol category photos,
                  fssai-logo.png = FSSAI logo (original logo yahan daalein).


DEPLOY (sabse aasaan)
---------------------
1. Netlify: app.netlify.com/drop par poora folder drag-drop karein. Free hai, link mil jata hai.
2. Cloudflare Pages / GitHub Pages / Vercel: folder upload karein, build command khaali rakhein.
3. Apna domain jodna ho to hosting ke "Custom domain" mein jodein.
Folder ke andar index.html root par honi chahiye.

index.html mein kya badalna hai (script ke shuru mein)
-----------------------------------------------------
var CFG = { upi:"...", name:"Yugal Agro", ship:40, wa:"91XXXXXXXXXX", pw:"admin password" }
  upi  = aapki UPI ID (QR iske hisaab se banta hai)
  wa   = WhatsApp number (91 ke saath, + ke bina)
  pw   = admin password (zaroor badlein)
var P = [...]  -> products, naam, unit aur price
<script id="pd"> -> admin ke saved prices/phone/email/awards yahan JSON mein rehte hain

DHYAN DEIN
----------
- Admin panel ka "Save & Exit" sirf Claude ke andar customers ke liye update karta hai.
  Apni hosting par ye sirf us screen par badlega. Sabke liye price badalne ke liye ya to
  index.html ke <script id="pd"> block mein JSON paste karein, ya baad mein backend
  (Firebase / Supabase) jodna hoga.
- Admin password page ke code mein dikhta hai, isliye asli suraksha ke liye backend login chahiye.
- Internet chahiye: Google Fonts aur QR library (cdnjs) online se aati hain.
- Policies ka text draft hai, publish se pehle jaanch lein.

FINAL VERSION - NAYA KYA HAI
----------------------------
- Admin panel: login ke baad upar right mein ⏻ "Logout" button (power icon). Ye logout karke panel band karta hai.
- Top menu ab right side mein hai: Home, Products, My Orders, Favourites, Track Order, About Us, Policies, FAQ, Contact.
  Scroll karne par current section highlight hota hai.
- Header mein: Search (live filter), Favourites (heart), Customer Login, Theme, Cart.
- Product card par heart: favourite save hota hai.
- My Orders: order place karne par device mein save hota hai, Track button se seedha tracking par.
- Customer Login: naam + mobile se. Checkout mein naam/phone khud bhar jata hai.

DHYAN DEIN (Orders / Favourites / Customer Login)
-------------------------------------------------
Ye teeno abhi browser (device) mein save hote hain, server par nahi. Customer doosre phone par login karega
to purane orders nahi dikhenge, aur aap admin se saare customers ke orders nahi dekh sakte.
Asli customer accounts, OTP login aur admin ke liye orders list ke liye backend (Firebase / Supabase) jodna hoga.
Ye agla section hai jo aap add karenge.

HERO VIDEO (NAYA)
-----------------
- Hero mein 5 videos background mein chalte hain, is order mein: Milk -> Paneer -> Ghee -> Dal -> Vermicompost, phir dobara shuru.
- Hero mein sirf video chalta hai (koi slide bar ya pause button nahi).
- Videos bina awaaz ke hain (autoplay ke liye zaroori). Original se compress kiye gaye hain (har video ~1-1.7 MB), taaki site tez khule.
- Video badalna ho to videos/ mein usi naam se nayi file daalein (milk.mp4, paneer.mp4, ghee.mp4, dal.mp4, vermicompost.mp4).
  Best: 1280x720, MP4 (H.264), 10 second, bina audio.
- Jab video chal na sake (slow net / data saver) tab poster photo (videos/*-poster.jpg) dikhti hai.
- Hosting par videos/ folder index.html ke saath hi upload karein.

ADMIN TAB (NAYA)
----------------
Footer mein "Contact Us" ke neeche "🔐 Admin" tab hai. Usse admin login khulta hai, jahan se prices, business info,
payment aur awards badalte hain. Pehle wala chhota Admin link neeche ki bar se hata diya gaya hai.

AUTOPLAY (FIX)
--------------
Hero video ab har browser par bina click ke chalta hai (desktop, Android, iPhone). Video muted hona zaroori hai, isliye awaaz nahi hai.
Agar iPhone ka Low Power Mode / data saver autoplay roke, to poster photo dikhti hai aur pehle touch ya scroll par video chal padta hai.
Video ke beech ka transition smooth fade hai, aur hero se bahar jaane par video ruk jata hai (battery bachti hai).
