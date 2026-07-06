package com.shopguide.agent.network

/**
 * 后端 API 地址配置。
 *
 * Android 模拟器访问电脑本机服务时不能使用 localhost，因为 localhost 会指向模拟器自己。
 * 10.0.2.2 是 Android 模拟器约定的宿主机地址，适合本机开发时直接连接 Node 后端。
 *
 * 如果改用真机调试，需要把 BASE_URL 改成电脑当前局域网 IP，例如：
 * http://10.190.151.103:3001
 */
object ApiConfig {
    const val BASE_URL = "http://10.0.2.2:3001"
    const val CHAT_PRODUCT_LIMIT = 4
}
