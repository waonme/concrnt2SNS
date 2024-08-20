const at = require('@atproto/api')

class AtProtocol {
    constructor(service, identifier, appPassword) {
        this.agent = new at.BskyAgent({ service });
        
        this.loginSuccess = false;
        this.agent.login({
            identifier: identifier,
            password: appPassword
        }).then(res => {
            console.log(`BS Login successful: ${identifier}`);
            this.loginSuccess = true;
        }).catch(err => {
            console.error(`BS Login failed for ${identifier}:`, err);
        });
    }

    async post(text, filesBuffer, label) {
        if (!this.loginSuccess) {
            console.error("Cannot post: not logged in");
            return;
        }
        const images = await this.uploadMedia(filesBuffer)
    
        const rt = new at.RichText({
            text: text
        })
        await rt.detectFacets(this.agent)
    
        let record = {
            text: rt.text,
            facets: rt.facets,
            embed: {
                $type: 'app.bsky.feed.post',
            },
            createdAt: new Date().toISOString(),
        }
    
        if (images.length > 0) {
            record.embed = {
                $type: 'app.bsky.embed.images',
                images: images
            }
        }
    
        // labelが存在し、かつ文字列である場合のみself-labelを追加
        if (label && typeof label === 'string') {
            record.labels = {
                $type: 'com.atproto.label.defs#selfLabels',
                values: [{ val: label }]
            };
        }
    
        await this.agent.post(record)
    }
    

    async uploadMedia(filesBuffer) {
        if (!filesBuffer) {
            return [];
        }
        const maxRetries = 3;
        let attempts = 0;
    
        while (attempts < maxRetries) {
            try {
                return await Promise.all(filesBuffer.filter(file => file.type.indexOf("image") >= 0).map(async (file) => {
                    const result = await this.agent.uploadBlob(
                        file.uint8Array,
                        { encoding: file.type }
                    );
    
                    return {
                        alt: "",
                        image: result.data.blob,
                        aspectRatio: { width: 3, height: 2 }
                    };
                }));
            } catch (error) {
                attempts++;
                if (attempts >= maxRetries) {
                    console.error('Upload failed after maximum retries:', error);
                    throw error;
                } else {
                    console.warn(`Upload attempt ${attempts} failed, retrying...`);
                }
            }
        }
    }    
}

module.exports = AtProtocol

