import axios from 'axios'

const webhookURL = "https://maker.ifttt.com/trigger/posted/with/key/bKXgMBs1TGXXl_LRz_706h"
const testText = `テスト投稿 from concrnt2SNS: ${new Date().toLocaleString('ja-JP')}`

console.log('Sending test webhook...')
console.log('Text:', testText)

try {
    const response = await axios.post(webhookURL, {
        value1: testText,
        value2: undefined
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
    
    console.log('Response:', response.status, response.statusText)
    console.log('Response data:', response.data)
} catch (error) {
    console.error('Error:', error.message)
    if (error.response) {
        console.error('Response status:', error.response.status)
        console.error('Response data:', error.response.data)
    }
}