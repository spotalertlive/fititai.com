let userImage = null;

async function processPhoto() {
    const fileInput = document.getElementById('userPhoto');
    const resultsSection = document.getElementById('results');
    
    if (fileInput.files.length === 0) {
        alert('Please upload a photo first.');
        return;
    }

    userImage = fileInput.files[0];
    
    try {
        fileInput.disabled = true;
        document.querySelector('.cta-button').textContent = 'Analyzing...';
        
        const imageElement = new Image();
        imageElement.src = URL.createObjectURL(userImage);
        
        await new Promise((resolve) => {
            imageElement.onload = resolve;
        });

        await window.bodyAI.analyzeImage(imageElement);
        
        resultsSection.style.display = 'block';
        document.querySelector('.cta-button').textContent = 'Analyze My Body';
        
    } catch (error) {
        console.error('Error processing photo:', error);
        alert('Failed to analyze the photo. Please try another image.');
        document.querySelector('.cta-button').textContent = 'Analyze My Body';
    } finally {
        fileInput.disabled = false;
    }
}

function tryOnGarment(garmentType) {
    const previewSection = document.getElementById('preview');
    const garmentPreview = document.getElementById('garmentPreview');
    
    const garments = {
        tshirt: {
            name: "Premium T-Shirt",
            fit: "92% match",
            details: "Perfect for your shoulder width and torso length"
        },
        dress: {
            name: "Summer Dress",
            fit: "88% match",
            details: "Great length for your height with comfortable fit"
        },
        jacket: {
            name: "Denim Jacket",
            fit: "95% match",
            details: "Excellent sleeve length and shoulder fit"
        }
    };

    const garment = garments[garmentType];
    
    garmentPreview.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 10px;">${garmentType === 'tshirt' ? '👕' : garmentType === 'dress' ? '👗' : '🧥'}</div>
            <h3>${garment.name}</h3>
            <p><strong>Fit Score:</strong> ${garment.fit}</p>
            <p>${garment.details}</p>
            <div style="margin-top: 20px; padding: 15px; background: #e8f5e8; border-radius: 8px;">
                <strong>✅ Perfect fit for your body type!</strong>
            </div>
        </div>
    `;
    
    previewSection.style.display = 'block';
    previewSection.scrollIntoView({ behavior: 'smooth' });
}

function resetApp() {
    document.getElementById('userPhoto').value = '';
    document.getElementById('results').style.display = 'none';
    document.getElementById('preview').style.display = 'none';
    userImage = null;
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('Fit it AI initialized');
});
