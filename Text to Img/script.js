
//Api from Open ai (not free)
/*const api="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"
const inp=document.getElementById("inp");
const images=document.querySelector(".images");
const getImage = async () =>{
   console.log("click");
   //request
    const methods = {
        method:"POST",
        headers:{
            "Content-Type":"application/json",
            "Authorization":`Bearer ${api}`
        },
        body:JSON.stringify(
            {
            "model": "gpt-image-1",
            "prompt":inp.value,
            "n":1,
            "size":'1024x1024'
        }
        )
    }
    const res=await fetch("https://api.openai.com/v1/images/generations",methods);
      //response  
    const data=await res.json();
        //console.log(data);
    const listImage=data.data;
    images.innerHTML='';
    listImage.map(photo=>{
        const container=document.createElement("div");
        images.append(container);
        const img=document.createElement("img");
        container.append(img);
        img.src=photo.url;
    }
    )
}*/
//free Api key for testing purpose only
const inp = document.getElementById("inp");
const images = document.querySelector(".images");

const getImage = async () => {
   // console.log("click");
    
    if (!inp.value.trim()) {
        alert("please enter a prompt!");
        return;
    }
    
    // loading  
    images.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #fff; padding: 30px; font-size: 18px;">⏳ جاري التحميل...</div>';
    
    const prompt = inp.value.trim();
    
    // مسح loading وبدء عرض الصور
    setTimeout(() => {
        images.innerHTML = '';
        
        // توليد 3 صور
        for (let i = 0; i < 3; i++) {
            const seed = Math.floor(Math.random() * 1000000);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=256&height=256&nologo=true`;
            
            // إنشاء container
            const container = document.createElement("div");
            container.style.position = "relative";
            images.append(container);
            
            // Loading icon
            const loader = document.createElement("div");
            loader.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 30px;
            `;
            loader.textContent = "⏳";
            container.append(loader);
            
            // الصورة
            const img = document.createElement("img");
            img.src = imageUrl;
            img.alt = prompt;
            img.style.opacity = "0";
            img.style.transition = "opacity 0.3s";
            
            img.onload = () => {
                loader.remove();
                img.style.opacity = "1";
                container.style.backgroundColor = "transparent";
            };
            
            img.onerror = () => {
                loader.textContent = "❌";
            };
            
            container.append(img);
            
            // زر Download
            const downloadBtn = document.createElement("button");
            downloadBtn.textContent = "⬇️";
            downloadBtn.style.cssText = `
                position: absolute;
                top: 5px;
                right: 5px;
                background: rgba(0,0,0,0.8);
                color: white;
                border: none;
                padding: 5px 10px;
                cursor: pointer;
                border-radius: 5px;
                opacity: 0;
                transition: opacity 0.2s;
            `;
            
            container.onmouseenter = () => downloadBtn.style.opacity = "1";
            container.onmouseleave = () => downloadBtn.style.opacity = "0";
            
            downloadBtn.onclick = () => {
                const a = document.createElement("a");
                a.href = imageUrl;
                a.download = `image-${seed}.png`;
                a.click();
            };
            
            container.append(downloadBtn);
        }
    }, 500);
};