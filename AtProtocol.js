const at = require('@atproto/api')

class AtProtocol {
    constructor(service, Identifier, appPassword) {
        this.agent = new at.BskyAgent({
            service: service
        })

        this.agent.login({
            identifier: Identifier,
            password: appPassword
        }).then(res => {
            console.log(`BS Login : ${res}`)
        })
    }

    async post(text, filesBuffer, label) {  // label パラメータを追加
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
    
        try {
            return await Promise.all(filesBuffer.filter((file) => file.type.indexOf("image") >= 0).map(async (file) => {
                const result = await this.agent.uploadBlob(
                    file.uint8Array,
                    {
                        encoding: file.type,
                    }
                );
    
                return {
                    alt: "",
                    image: result.data.blob,
                    aspectRatio: {
                        width: 3,
                        height: 2
                    }
                };
            }));
        } catch (error) {
            console.error("Error during media upload:", error);
            throw error;
        }
    }
}

module.exports = AtProtocol

