const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config(); // To load environment variables from .env file

const app = express();
const upload = multer(); // For handling file uploads

// Initialize S3 client
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Serve static files from the "public" directory
app.use(express.static('public'));

// Serve index.html when the root path is accessed
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Connect to MySQL RDS (Using async/await)
(async () => {
    try {
        global.connection = await mysql.createConnection({
            host: process.env.RDS_HOST,
            user: process.env.RDS_USER,
            password: process.env.RDS_PASSWORD,
            database: process.env.RDS_DATABASE
        });
        console.log('Connected to MySQL RDS');
    } catch (error) {
        console.error('Could not connect to RDS:', error);
    }
})();

// Upload route to handle file uploads
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        // Upload image to S3 and generate a presigned URL
        const s3Response = await uploadImage(req.file);

        // Store metadata in RDS
        const metadata = {
            url: s3Response.Location,
            description: req.body.description
        };
        await storeMetadata(metadata);

        res.status(200).send('Image and metadata uploaded successfully');
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).send('Error uploading image');
    }
});

// Function to upload image to S3 and generate a presigned URL
const uploadImage = async (file) => {
    const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'private' // Ensure file is private
    };

    // Upload the file to S3
    try {
        await s3.send(new PutObjectCommand(uploadParams));
    } catch (err) {
        console.error('Error uploading to S3:', err);
        throw err;
    }

    // Generate a presigned URL for accessing the file
    const urlParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: file.originalname
    };

    try {
        const command = new GetObjectCommand(urlParams);
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // URL expires in 1 hour
        return {
            Location: presignedUrl
        };
    } catch (err) {
        console.error('Error generating presigned URL:', err);
        throw err;
    }
};

// Function to store metadata in RDS
const storeMetadata = async (imageData) => {
    const query = `
        INSERT INTO image_metadata (image_url, uploaded_at, description)
        VALUES (?, NOW(), ?)
    `;
    try {
        const [rows] = await connection.execute(query, [imageData.url, imageData.description]);
        return rows;
    } catch (err) {
        console.error('Error storing metadata:', err);
        throw err;
    }
};

// Start the server
app.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on port 3000');
});

