import React from "react";
import { Text, View } from "@tarojs/components";
import "./RichTextContent.scss";

export function RichTextContent({ content }: { content: string }) {
  return (
    <View className="rich-content">
      {content.split(/\r?\n/).map((line, index) => (
        <View key={`${index}-${line}`} className={line.trim() ? "md-line" : "md-line md-spacer"}>
          {line.trim() ? renderInlineMarkdown(line) : <Text> </Text>}
        </View>
      ))}
    </View>
  );
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text))) {
    if (match.index > cursor) nodes.push(<Text key={`t-${cursor}`}>{text.slice(cursor, match.index)}</Text>);
    nodes.push(
      <Text key={`b-${match.index}`} className="md-strong">
        {match[1]}
      </Text>
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(<Text key={`t-${cursor}`}>{text.slice(cursor)}</Text>);
  return nodes.length ? nodes : <Text>{text}</Text>;
}
